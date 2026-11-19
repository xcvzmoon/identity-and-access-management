import type { Configuration } from 'openid-client';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Provider } from './provider.ts';
import { getMigrations } from 'better-auth/db/migration';
import { decodeProtectedHeader } from 'jose';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import filepath from 'node:path';
import * as oidc from 'openid-client';
import { Pool } from 'pg';
import { chromium } from 'playwright';
import { createClient } from './client.ts';
import { dispatchProvider, listen } from './http.ts';
import { authPath, createProvider, initializePolicy, managementPermission } from './provider.ts';
import { completePasskeyStepUp, exchangeOnReplica, proveRollover } from './security-checks.ts';

const okStatus = 200;
const firstRow = 0;
const lastIndex = -1;
const noEntries = 0;
const unauthorized = 401;
const noRedirects = 0;
const inviteLifetimeMs = 60_000;
const databasePort = 56_427;
const secretBytes = 32;
const forbidden = 403;
const notFound = 404;
const badRequest = 400;
const unavailable = 503;
const password = 'fixture-passphrase-only';
const newPassword = 'fixture-changed-passphrase';
const email = 'owner@example.test';
const secondEmail = 'no-membership@example.test';
const operatorEmail = 'operator@example.test';
const reportPermission = 'reports.read';

async function invite(
  pool: Pool,
  address: string,
  organization: string,
  expires: Date,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into evaluation_invitations (email, organization, expires_at) values ($1, $2, $3) returning id',
    [address, organization, expires],
  );
  const invitation = rows.at(firstRow);
  ok(invitation);
  return invitation.id;
}

async function post(
  browser: BrowserContext,
  issuer: string,
  path: string,
  data: Record<string, string>,
): Promise<number> {
  const response = await browser.request.post(new URL(path, issuer).href, {
    data,
    headers: { origin: issuer },
    maxRedirects: noRedirects,
  });
  return response.status();
}

async function pageStatus(page: Page, target: string): Promise<number | undefined> {
  const response = await page.goto(target);
  return response?.status();
}

async function signIn(page: Page, address: string): Promise<void> {
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function allow(page: Page, name: string): Promise<void> {
  await page.getByRole('heading', { name: 'Confirm application access' }).waitFor();
  await page.getByText(name, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Allow' }).click();
}

async function checkSession(page: Page, origin: string, name: string): Promise<void> {
  await page.waitForURL(`${origin}/`);
  equal(await page.locator('body').textContent(), `${name} session`);
}

async function verifyAccount(
  browser: BrowserContext,
  verificationEmails: Map<string, string>,
  address: string,
): Promise<void> {
  const link = verificationEmails.get(address);
  ok(link, 'A verification email must be queued');
  const response = await browser.request.get(link);
  equal(response.ok(), true);
}

async function nativeRequestCheck(
  configuration: Configuration,
  origin: string,
  browser: BrowserContext,
): Promise<void> {
  const callback = new URL('/callback', origin);
  const request = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: callback.href,
    scope: 'openid',
  });
  const missingPkce = await browser.request.get(request.href, { maxRedirects: noRedirects });
  const errorRedirect = missingPkce.headers().location;
  ok(errorRedirect);
  equal(new URL(errorRedirect).searchParams.get('error'), 'invalid_request');

  request.searchParams.set('redirect_uri', new URL('/unregistered-callback', origin).href);
  const wrongCallback = await browser.request.get(request.href, { maxRedirects: noRedirects });
  const rejectedLocation = wrongCallback.headers().location;
  if (rejectedLocation) {
    equal(new URL(rejectedLocation, request).pathname === '/unregistered-callback', false);
  } else {
    equal(wrongCallback.ok(), false);
  }
}

type Listener = Awaited<ReturnType<typeof listen>>;
type Registration = {
  origin: string;
  clientId: string;
  clientSecret: string;
  name: string;
};
type Client = Awaited<ReturnType<typeof createClient>>;
type ClientSet = {
  consoleRegistration: Registration;
  northRegistration: Registration;
  southRegistration: Registration;
  consoleClient: Client;
  northClient: Client;
  southClient: Client;
};
type Invitations = {
  invitation: string;
  expired: string;
  otherInvitation: string;
  deadline: Date;
};
type ReportProof = {
  pool: Pool;
  issuer: string;
  fresh: BrowserContext;
  northRegistration: Registration;
  southRegistration: Registration;
  subject: string;
};

async function operatorSession(
  auth: Provider,
  issuer: string,
  browser: Browser,
  verificationEmails: Map<string, string>,
): Promise<string> {
  await auth.api.signUpEmail({
    body: {
      email: operatorEmail,
      password,
      name: 'Operator',
    },
  });
  const operatorContext = await browser.newContext({ ignoreHTTPSErrors: true });
  await verifyAccount(operatorContext, verificationEmails, operatorEmail);
  equal(
    await post(operatorContext, issuer, `${authPath}/sign-in/email`, {
      email: operatorEmail,
      password,
    }),
    okStatus,
  );
  const cookies = await operatorContext.cookies(issuer);
  return cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
}

async function registerClients(
  auth: Provider,
  pool: Pool,
  operatorCookie: string,
  endpoints: {
    issuer: string;
    introspectionEndpoint: string;
    consoleServer: Listener;
    northServer: Listener;
    southServer: Listener;
  },
): Promise<ClientSet> {
  const { issuer, introspectionEndpoint, consoleServer, northServer, southServer } = endpoints;
  async function register(
    port: number,
    host: string,
    name: string,
    organization: string | null,
  ): Promise<Registration> {
    const origin = `https://${host}.localhost:${port}`;
    const callback = new URL('/callback', origin).href;
    const { client_id: clientId, client_secret: clientSecret } =
      await auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie: operatorCookie }),
        body: {
          redirect_uris: [callback],
          scope: 'openid',
          client_name: name,
          application_type: 'web',
          token_endpoint_auth_method: 'client_secret_basic',
          grant_types: ['authorization_code'],
          require_pkce: true,
          skip_consent: organization === null,
        },
      });
    ok(clientSecret);
    await pool.query(
      'insert into evaluation_clients (id, name, organization, callback) values ($1, $2, $3, $4)',
      [clientId, name, organization, callback],
    );
    return { origin, clientId, clientSecret, name };
  }

  const consoleRegistration = await register(consoleServer.port, 'console', 'console', null);
  const northRegistration = await register(northServer.port, 'north', 'Reports', 'North');
  const southRegistration = await register(southServer.port, 'south', 'Reports', 'South');
  const registrations = [consoleRegistration, northRegistration, southRegistration];
  equal(new Set(registrations.map(({ clientId }) => clientId)).size, registrations.length);
  equal(new Set(registrations.map(({ clientSecret }) => clientSecret)).size, registrations.length);

  const [consoleClient, northClient, southClient] = await Promise.all(
    registrations.map(async (registration) =>
      createClient({
        origin: registration.origin,
        issuer,
        introspectionEndpoint,
        name: registration.name,
        credentials: registration,
        requiredPermission:
          registration === consoleRegistration ? managementPermission : reportPermission,
      }),
    ),
  );
  consoleServer.setHandler(consoleClient.handle);
  northServer.setHandler(northClient.handle);
  southServer.setHandler(southClient.handle);
  return {
    consoleRegistration,
    northRegistration,
    southRegistration,
    consoleClient,
    northClient,
    southClient,
  };
}

async function proveSignup(
  pool: Pool,
  issuer: string,
  context: BrowserContext,
  verificationEmails: Map<string, string>,
): Promise<Invitations> {
  const deadline = new Date(Date.now() + inviteLifetimeMs);
  const invitation = await invite(pool, email, 'North', deadline);
  const expired = await invite(pool, email, 'North', new Date(firstRow));
  const otherInvitation = await invite(pool, secondEmail, 'South', deadline);
  const form = { invitation, email, password };
  equal(
    await post(context, issuer, `${authPath}/sign-up/email`, {
      ...form,
      name: 'Owner',
    }),
    notFound,
  );
  equal(
    await post(context, issuer, '/invitation/sign-up', {
      ...form,
      email: secondEmail,
    }),
    forbidden,
  );
  equal(
    await post(context, issuer, '/invitation/sign-up', {
      ...form,
      invitation: expired,
    }),
    forbidden,
  );
  equal(await post(context, issuer, '/invitation/sign-up', form), okStatus);
  equal(await post(context, issuer, `${authPath}/sign-in/email`, { email, password }), forbidden);
  await verifyAccount(context, verificationEmails, email);
  process.stdout.write('PASS invite-only signup and verified-email enforcement\n');
  return { invitation, expired, otherInvitation, deadline };
}

async function proveConsole(
  pool: Pool,
  issuer: string,
  context: BrowserContext,
  { consoleRegistration, consoleClient }: ClientSet,
): Promise<{ page: Page; idToken: string; subject: string }> {
  const page = await context.newPage();
  await page.goto(`${consoleRegistration.origin}/sign-in`);
  await signIn(page, email);
  await checkSession(page, consoleRegistration.origin, 'console');
  const initialConsole = [...consoleClient.sessions.values()].at(lastIndex);
  ok(initialConsole);
  equal(decodeProtectedHeader(initialConsole.idToken).alg, 'RS256');
  const { rowCount: memberships } = await pool.query(
    'select 1 from evaluation_memberships where user_id = $1',
    [initialConsole.subject],
  );
  equal(memberships, noEntries);
  const consoleCookie = `__Host-session-${consoleRegistration.clientId}`;
  const issuerCookies = await context.cookies(issuer);
  const clientCookies = await context.cookies(consoleRegistration.origin);
  equal(
    issuerCookies.some(({ name }) => name === consoleCookie),
    false,
  );
  equal(
    clientCookies.some(({ name }) => name === consoleCookie),
    true,
  );
  process.stdout.write(
    'PASS console code exchange and RS256 ID token for a verified user with zero memberships\n',
  );
  return {
    page,
    idToken: initialConsole.idToken,
    subject: initialConsole.subject,
  };
}

async function proveAcceptance(
  pool: Pool,
  issuer: string,
  context: BrowserContext,
  invitations: Invitations,
): Promise<void> {
  const { invitation, expired, otherInvitation, deadline } = invitations;
  equal(
    await post(context, issuer, '/invitation/accept', { invitation: otherInvitation }),
    forbidden,
  );
  equal(await post(context, issuer, '/invitation/accept', { invitation: expired }), forbidden);
  equal(await post(context, issuer, '/invitation/accept', { invitation }), okStatus);
  equal(await post(context, issuer, '/invitation/accept', { invitation }), forbidden);
  const existing = await invite(pool, email, 'South', deadline);
  equal(await post(context, issuer, '/invitation/accept', { invitation: existing }), okStatus);
  process.stdout.write('PASS same-email invitation acceptance and expiry and replay checks\n');
}

async function proveConsent(
  proof: ReportProof,
  clients: ClientSet,
  context: BrowserContext,
  introspectionEndpoint: string,
): Promise<Page> {
  const { pool, fresh, northRegistration, southRegistration, subject } = proof;
  const { northClient, southClient } = clients;
  await pool.query('insert into evaluation_grants values ($1, $2, $3, $4)', [
    northRegistration.clientId,
    subject,
    randomUUID(),
    reportPermission,
  ]);
  await nativeRequestCheck(northClient.configuration, northRegistration.origin, context);

  const reports = await fresh.newPage();
  await reports.goto(`${northRegistration.origin}/sign-in`);
  await signIn(reports, email);
  await allow(reports, 'Reports');
  await checkSession(reports, northRegistration.origin, 'Reports');
  const northSession = [...northClient.sessions.values()].at(lastIndex);
  ok(northSession);
  equal(await pageStatus(reports, `${northRegistration.origin}/protected`), okStatus);
  equal(await pageStatus(reports, `${southRegistration.origin}/sign-in`), forbidden);
  equal(southClient.sessions.size, noEntries);
  await pool.query('insert into evaluation_grants values ($1, $2, $3, $4)', [
    southRegistration.clientId,
    subject,
    randomUUID(),
    reportPermission,
  ]);
  await reports.goto(`${southRegistration.origin}/sign-in`);
  await allow(reports, 'Reports');
  await checkSession(reports, southRegistration.origin, 'Reports');
  const wrongClient = await fetch(introspectionEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${southRegistration.clientId}:${southRegistration.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      token: northSession.token,
      token_type_hint: 'access_token',
    }),
  });
  deepEqual(await wrongClient.json(), { active: false });
  process.stdout.write(
    'PASS exact callback, mandatory S256, separate installations, and first consent during interactive and SSO flows\n',
  );
  return reports;
}

async function proveRevocation(
  proof: ReportProof,
  reports: Page,
  options: { northClient: Client; replica: string; setAvailability: (available: boolean) => void },
): Promise<void> {
  const { pool, issuer, fresh, northRegistration, southRegistration } = proof;
  const { northClient, replica, setAvailability } = options;
  await pool.query('update evaluation_grants set version = $1 where client_id = $2', [
    randomUUID(),
    northRegistration.clientId,
  ]);
  equal(await pageStatus(reports, `${northRegistration.origin}/protected`), forbidden);
  equal(await pageStatus(reports, `${southRegistration.origin}/protected`), okStatus);
  await reports.goto(`${northRegistration.origin}/sign-in`);
  await allow(reports, 'Reports');
  await checkSession(reports, northRegistration.origin, 'Reports');
  equal(await pageStatus(reports, `${northRegistration.origin}/protected`), okStatus);
  await rejects(
    exchangeOnReplica({
      page: reports,
      configuration: northClient.configuration,
      callback: `${northRegistration.origin}/callback`,
      tokenOrigin: replica,
      credentials: northRegistration,
      beforeExchange: async () => {
        await pool.query('delete from evaluation_grants where client_id = $1', [
          northRegistration.clientId,
        ]);
      },
    }),
    { error: 'invalid_grant' },
  );
  equal(await pageStatus(reports, `${northRegistration.origin}/protected`), forbidden);
  equal(await pageStatus(reports, `${northRegistration.origin}/sign-in`), forbidden);
  setAvailability(false);
  equal(await pageStatus(reports, `${southRegistration.origin}/protected`), unavailable);
  setAvailability(true);
  equal(await post(fresh, issuer, `${authPath}/sign-out`, {}), okStatus);
  equal(await pageStatus(reports, `${southRegistration.origin}/protected`), forbidden);
  process.stdout.write(
    'PASS replica introspection, grant change, next-request revocation, sign-out, and unavailable checks\n',
  );
}

async function proveAudit(
  pool: Pool,
  { northRegistration, southRegistration }: ClientSet,
  subject: string,
): Promise<void> {
  const { rows: audit } = await pool.query<{
    organization: string;
    user_id: string;
    client_id: string;
    outcome: string;
    recorded_at: Date;
  }>('select * from evaluation_audit order by recorded_at');
  deepEqual(
    audit.map(({ organization, outcome }) => [organization, outcome]),
    [
      ['North', 'approved'],
      ['South', 'denied'],
      ['South', 'approved'],
      ['North', 'approved'],
      ['North', 'denied'],
    ],
  );
  for (const event of audit) {
    deepEqual(Object.keys(event).toSorted(), [
      'client_id',
      'organization',
      'outcome',
      'recorded_at',
      'user_id',
    ]);
    equal(event.user_id, subject);
    equal(
      event.client_id,
      event.organization === 'North' ? northRegistration.clientId : southRegistration.clientId,
    );
    ok(event.recorded_at instanceof Date);
  }
  process.stdout.write(
    'PASS bounded audit records for customer authorization with credentials and through SSO\n',
  );
}

async function proveRecovery(
  issuer: string,
  context: BrowserContext,
  resetEmails: Map<string, string>,
): Promise<void> {
  equal(
    await post(context, issuer, `${authPath}/request-password-reset`, {
      email,
      redirectTo: issuer,
    }),
    okStatus,
  );
  const resetLink = resetEmails.get(email);
  ok(resetLink);
  const token = new URL(resetLink).pathname.split('/').at(lastIndex);
  ok(token);
  equal(
    await post(context, issuer, `${authPath}/reset-password`, { token, newPassword }),
    okStatus,
  );
  equal(
    await post(context, issuer, `${authPath}/reset-password`, { token, newPassword }),
    badRequest,
  );
  const previousSession = await context.request.get(`${issuer}${authPath}/get-session`);
  equal(await previousSession.json(), null);
  equal(
    await post(context, issuer, `${authPath}/sign-in/email`, { email, password }),
    unauthorized,
  );
  equal(
    await post(context, issuer, `${authPath}/sign-in/email`, {
      email,
      password: newPassword,
    }),
    okStatus,
  );
  process.stdout.write(
    'PASS password reset invalidates the previous IAM session and old credentials\n',
  );
}

async function proveStepUp(
  proof: ReportProof,
  page: Page,
  reports: Page,
  consoleOrigin: string,
): Promise<void> {
  const { pool, issuer, subject, fresh } = proof;
  await pool.query(
    "update evaluation_memberships set role = 'owner' where user_id = $1 and organization = 'North'",
    [subject],
  );
  equal(await pageStatus(page, `${issuer}/admin/step-up`), forbidden);
  await page.goto(`${consoleOrigin}/sign-in`);
  await checkSession(page, consoleOrigin, 'console');
  equal(await pageStatus(page, `${consoleOrigin}/protected`), forbidden);
  await completePasskeyStepUp(page, issuer);
  equal(await pageStatus(page, `${issuer}/admin/step-up`), okStatus);
  equal(await pageStatus(page, `${consoleOrigin}/protected`), forbidden);
  await page.goto(`${consoleOrigin}/sign-in`);
  await checkSession(page, consoleOrigin, 'console');
  equal(await pageStatus(page, `${consoleOrigin}/protected`), okStatus);
  equal(
    await post(fresh, issuer, `${authPath}/sign-in/email`, {
      email,
      password: newPassword,
    }),
    okStatus,
  );
  equal(await pageStatus(reports, `${issuer}/admin/step-up`), forbidden);
  await reports.goto(`${consoleOrigin}/sign-in`);
  await checkSession(reports, consoleOrigin, 'console');
  equal(await pageStatus(reports, `${consoleOrigin}/protected`), forbidden);
  await pool.query("update evaluation_step_up set verified_at = now() - interval '6 minutes'");
  equal(await pageStatus(page, `${issuer}/admin/step-up`), forbidden);
  equal(await pageStatus(page, `${consoleOrigin}/protected`), forbidden);
  process.stdout.write(
    'PASS WebAuthn step-up is bound to the authenticated owner session and expires\n',
  );
}

type CheckOptions = {
  clients: ClientSet;
  context: BrowserContext;
  fresh: BrowserContext;
  issuer: string;
  pool: Pool;
  replica: string;
  secret: string;
  introspectionEndpoint: string;
  verificationEmails: Map<string, string>;
  resetEmails: Map<string, string>;
  setAvailability: (available: boolean) => void;
};

async function runChecks(options: CheckOptions): Promise<void> {
  const {
    clients,
    context,
    fresh,
    issuer,
    pool,
    replica,
    secret,
    introspectionEndpoint,
    verificationEmails,
    resetEmails,
    setAvailability,
  } = options;
  const invitations = await proveSignup(pool, issuer, context, verificationEmails);
  const { consoleRegistration, consoleClient, northRegistration, southRegistration } = clients;
  const { page, idToken, subject } = await proveConsole(pool, issuer, context, clients);
  await proveAcceptance(pool, issuer, context, invitations);
  const proof = {
    pool,
    issuer,
    fresh,
    northRegistration,
    southRegistration,
    subject,
  };
  const reports = await proveConsent(proof, clients, context, introspectionEndpoint);
  await proveRevocation(proof, reports, {
    northClient: clients.northClient,
    replica,
    setAvailability,
  });
  await proveAudit(pool, clients, subject);
  await proveRecovery(issuer, context, resetEmails);
  await proveRollover({
    pool,
    issuer,
    replica,
    secret,
    audience: consoleRegistration.clientId,
    originalIdToken: idToken,
    issueIdToken: async (tokenOrigin) =>
      exchangeOnReplica({
        page,
        configuration: consoleClient.configuration,
        callback: `${consoleRegistration.origin}/callback`,
        tokenOrigin,
        credentials: consoleRegistration,
      }),
  });

  await proveStepUp(proof, page, reports, consoleRegistration.origin);
}

async function evaluate(pool: Pool, replicaPool: Pool, scratch: string): Promise<void> {
  const tls = {
    cert: await readFile(filepath.join(scratch, 'tls-cert.pem')),
    key: await readFile(filepath.join(scratch, 'tls-key.pem')),
  };
  const [first, second, consoleServer, northServer, southServer] = await Promise.all([
    listen(tls),
    listen(tls),
    listen(tls),
    listen(tls),
    listen(tls),
  ]);
  const servers = [first, second, consoleServer, northServer, southServer];
  const issuer = `https://localhost:${first.port}`;
  const replica = `https://127.0.0.1:${second.port}`;
  const introspectionEndpoint = `${replica}${authPath}/oauth2/introspect`;
  const verificationEmails = new Map<string, string>();
  const resetEmails = new Map<string, string>();
  const secret = randomBytes(secretBytes).toString('base64url');
  const auth = createProvider({
    pool,
    issuer,
    verificationEmails,
    resetEmails,
    secret,
    operatorEmail,
  });
  const secondaryAuth = createProvider({
    pool: replicaPool,
    issuer,
    verificationEmails,
    resetEmails,
    secret,
    operatorEmail,
  });
  const browser = await chromium.launch();
  try {
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
    await initializePolicy(pool);
    first.setHandler(async (request) => dispatchProvider(request, auth, pool));
    const replicaStatus = { available: true };
    second.setHandler(async (request) =>
      replicaStatus.available
        ? dispatchProvider(request, secondaryAuth, replicaPool)
        : new Response(null, { status: unavailable }),
    );

    const operatorCookie = await operatorSession(auth, issuer, browser, verificationEmails);
    const clients = await registerClients(auth, pool, operatorCookie, {
      issuer,
      introspectionEndpoint,
      consoleServer,
      northServer,
      southServer,
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const fresh = await browser.newContext({ ignoreHTTPSErrors: true });
    await runChecks({
      clients,
      context,
      fresh,
      issuer,
      pool,
      replica,
      secret,
      introspectionEndpoint,
      verificationEmails,
      resetEmails,
      setAvailability: (available) => {
        replicaStatus.available = available;
      },
    });
  } finally {
    await browser.close();
    for (const { server } of servers) {
      server.close();
      server.closeAllConnections();
    }
  }
}

const socket = process.env.IAM_EVAL_PG_SOCKET;
ok(socket, 'Start the fixture with run-local.sh');
const pool = new Pool({
  host: socket,
  port: databasePort,
  database: 'iam_eval',
  user: 'iam_eval',
});
const replicaPool = new Pool({
  host: socket,
  port: databasePort,
  database: 'iam_eval',
  user: 'iam_eval',
});
try {
  await evaluate(pool, replicaPool, socket);
} finally {
  await Promise.all([pool.end(), replicaPool.end()]);
}
