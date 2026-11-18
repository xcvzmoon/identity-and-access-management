import type { Auth, AuthOptions } from '../../../packages/auth/src/utils/auth.ts';
import type { RollbackSession } from './oidc-pilot-rollback.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import * as oidc from 'openid-client';
import * as valibot from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createAuth } from '../../../packages/auth/src/utils/auth.ts';
import { registerApplication } from '../../../packages/auth/src/utils/register-application.ts';
import { createDatabase } from '../../../packages/database/src/utils/client.ts';
import {
  changeApplicationAssignment,
  registerApplicationPermissions,
  saveApplicationRole,
} from '../../../packages/database/src/utils/manage-application-access.ts';
import {
  containPilot,
  submitAdminOperation,
  verifyReplicaSigningKey,
} from './oidc-pilot-rollback.ts';

const { ClientSecretBasic: clientSecretBasic, ClientSecretPost: clientSecretPost } = oidc;
const configuredIssuer = process.env.AUTH_OIDC_TEST_URL;
const replicaOrigin = process.env.AUTH_OIDC_REPLICA_TEST_URL;
const unavailableOrigin = process.env.AUTH_OIDC_UNAVAILABLE_TEST_URL;
const issuer = configuredIssuer ?? 'http://127.0.0.1:5173';
const databasePort = Number(process.env.AUTH_TEST_DB_PORT);
const callback = 'https://reference.example.test/callback';
const password = 'oidc-integration-test-password';
const secretBytes = 32;
const success = 200;
const seeOther = 303;
const unauthorized = 401;
const forbidden = 403;
const notFound = 404;
const serviceUnavailable = 503;

type Database = ReturnType<typeof createDatabase>;
type Application = Awaited<ReturnType<typeof registerApplication>>;
type LoginRequest = {
  authorizationUrl: URL;
  verifier: string;
  state: string;
  nonce: string;
};

function sessionCookies(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((value) => {
      const [pair] = value.split(';');
      return pair;
    })
    .join('; ');
}

async function provisionActor(
  database: Database,
  auth: Auth,
  email: string,
  name: string,
): Promise<{ userId: string; cookie: string }> {
  const { user } = await auth.api.signUpEmail({ body: { name, email, password } });
  await database.$client`update iam.users set email_verified = true where id = ${user.id}`;
  const session = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const userId = session.response.user.id;
  const cookie = sessionCookies(session.headers);
  return { userId, cookie };
}

type ApplicationFixtureOptions = {
  permissionKey?: string;
  tokenEndpointAuthMethod?: Application['tokenEndpointAuthMethod'];
};

async function provisionApplication(
  database: Database,
  slug: string,
  email: string,
  fixture: ApplicationFixtureOptions = {},
): Promise<{
  app: Application;
  otherApp: Application;
  actorId: string;
  memberId: string;
  organizationId: string;
}> {
  const { permissionKey = 'reports.read', tokenEndpointAuthMethod } = fixture;
  const options: AuthOptions = {
    secret: randomBytes(secretBytes).toString('hex'),
    url: issuer,
    webOrigin: issuer,
  };
  const auth = createAuth(database, options);
  const { userId: actorId, cookie } = await provisionActor(database, auth, email, 'Reference user');
  const organization = await auth.api.createOrganization({
    body: {
      name: 'Reference organization',
      slug,
      userId: actorId,
    },
  });
  const [{ id: memberId }] = await database.$client<{ id: string }[]>`
    select id from iam.members where organization_id = ${organization.id} and user_id = ${actorId}
  `;
  const headers = new Headers({ cookie });
  const app = await registerApplication(database, options, headers, {
    organizationId: organization.id,
    name: 'Reference & Reports',
    redirectUri: callback,
    tokenEndpointAuthMethod,
  });
  const otherApp = await registerApplication(database, options, headers, {
    organizationId: organization.id,
    name: 'Other reference app',
    redirectUri: callback,
  });
  const manager = {
    actorId,
    installationId: app.installationId,
  };
  await registerApplicationPermissions(database, manager, [permissionKey]);
  await saveApplicationRole(database, manager, {
    key: 'reader',
    permissionKeys: [permissionKey],
  });
  await changeApplicationAssignment(database, manager, {
    action: 'grant',
    memberId,
    roleKeys: ['reader'],
  });
  return {
    app,
    otherApp,
    actorId,
    memberId,
    organizationId: organization.id,
  };
}

function redirectLocation(response: Response): URL {
  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`Expected a redirect, received HTTP ${response.status}`);
  }

  return new URL(location);
}

async function discoverApplication(app: Application): Promise<oidc.Configuration> {
  const url = new URL(issuer);
  const execute = [oidc.enableNonRepudiationChecks];

  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
    // The SDK provides this exception for HTTP tests against loopback fixtures.
    // oxlint-disable-next-line typescript/no-deprecated
    execute.unshift(oidc.allowInsecureRequests);
  }

  const authenticate =
    app.tokenEndpointAuthMethod === 'client_secret_post' ? clientSecretPost : clientSecretBasic;

  return oidc.discovery(
    url,
    app.clientId,
    {
      client_secret: app.clientSecret,
      id_token_signed_response_alg: 'RS256',
    },
    authenticate(app.clientSecret),
    { execute },
  );
}

async function startSignIn(
  config: oidc.Configuration,
  prompt: 'none' | 'login' | 'default' = 'default',
): Promise<LoginRequest> {
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callback,
    scope: 'openid',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
  });

  if (prompt !== 'default') {
    authorizationUrl.searchParams.set('prompt', prompt);
  }

  return { authorizationUrl, verifier, state, nonce };
}

async function submitInteraction(
  page: URL,
  cookie: string,
  fields: Record<string, string>,
  origin = issuer,
): Promise<Response> {
  return fetch(new URL(`/api${page.pathname}`, issuer), {
    method: 'POST',
    headers: { cookie, origin },
    body: new URLSearchParams({
      oauth_query: page.searchParams.toString(),
      ...fields,
    }),
    redirect: 'manual',
  });
}

function expectSessionCookieSecurity(headers: Headers): void {
  const session = headers
    .getSetCookie()
    .find((value) => value.includes('better-auth.session_token='));
  expect(session).toMatch(/;\s*HttpOnly(?:;|$)/iu);
  expect(session).toMatch(/;\s*SameSite=Lax(?:;|$)/iu);

  if (new URL(issuer).protocol === 'https:') {
    expect(session).toMatch(/^__Secure-better-auth\.session_token=/u);
    expect(session).toMatch(/;\s*Secure(?:;|$)/iu);
  }
}

async function completeSignIn(
  request: LoginRequest,
  email: string,
): Promise<{ callbackUrl: URL; cookie: string }> {
  const login = redirectLocation(await fetch(request.authorizationUrl, { redirect: 'manual' }));
  expect(login.origin + login.pathname).toBe(`${issuer}/oidc/login`);
  const loginPage = await fetch(login);
  expect(loginPage.status).toBe(success);
  expect(loginPage.headers.get('referrer-policy')).toBe('same-origin');
  const formPolicy = `frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${new URL(callback).origin}`;
  expect(loginPage.headers.get('content-security-policy')).toBe(formPolicy);
  const application = await fetch(
    `${issuer}/api/oidc/client?${new URLSearchParams({ request: login.searchParams.toString() })}`,
  );
  expect(await application.json()).toMatchObject({ name: 'Reference & Reports' });

  const credentials = { email, password };
  const foreign = await submitInteraction(login, '', credentials, 'https://other.example.test');
  expect(foreign.status).toBe(forbidden);
  const signedIn = await submitInteraction(login, '', credentials);
  expect(signedIn.status).toBe(seeOther);
  expectSessionCookieSecurity(signedIn.headers);
  const cookie = sessionCookies(signedIn.headers);
  expect(cookie).toContain('better-auth.session_token=');

  const consent = redirectLocation(signedIn);
  expect(consent.origin + consent.pathname).toBe(`${issuer}/oidc/consent`);
  const consentPage = await fetch(consent, { headers: { cookie } });
  expect(consentPage.status).toBe(success);
  expect(consentPage.headers.get('referrer-policy')).toBe('same-origin');
  expect(consentPage.headers.get('content-security-policy')).toBe(formPolicy);
  const accepted = await submitInteraction(consent, cookie, { intent: 'allow' });
  expect(accepted.status).toBe(seeOther);
  expect(accepted.headers.get('referrer-policy')).toBe('no-referrer');
  const callbackUrl = redirectLocation(accepted);
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(callback);
  return { callbackUrl, cookie };
}

async function removeFixture(database: Database, slug: string, email: string): Promise<void> {
  await database.$client.begin(async (transaction) => {
    await transaction`delete from iam.app_access_events where installation_id in (
      select installation.id from iam.app_installations installation
      join iam.organizations organization on organization.id = installation.organization_id
      where organization.slug = ${slug}
    )`;
    await transaction`delete from iam.app_roles where installation_id in (
      select installation.id from iam.app_installations installation
      join iam.organizations organization on organization.id = installation.organization_id
      where organization.slug = ${slug}
    )`;
    await transaction`delete from iam.app_permissions where application_id in (
      select application.id from iam.applications application
      join iam.organizations organization on organization.id = application.organization_id
      where organization.slug = ${slug}
    )`;
    await transaction`delete from iam.app_assignments where organization_id in (
      select id from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.app_clients where client_id in (
      select client_id from iam.oauth_clients where reference_id in (
        select id::text from iam.organizations where slug = ${slug}
      )
    )`;
    await transaction`delete from iam.oauth_clients where reference_id in (
      select id::text from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.app_installations where organization_id in (
      select id from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.applications where organization_id in (
      select id from iam.organizations where slug = ${slug}
    )`;
    await transaction`delete from iam.organizations where slug = ${slug}`;
    await transaction`delete from iam.users where email = ${email}`;
  });
}

async function exchange(
  config: oidc.Configuration,
  callbackUrl: URL,
  request: LoginRequest,
): Promise<oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers> {
  return oidc.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: request.verifier,
    expectedState: request.state,
    expectedNonce: request.nonce,
    idTokenExpected: true,
  });
}

type CredentialedMember = Awaited<ReturnType<typeof provisionApplication>>;

async function startWarmSignIn(
  config: oidc.Configuration,
  cookie: string,
  interaction: 'existing' | 'renew' | 'silent' = 'existing',
): Promise<{ request: LoginRequest; callbackUrl: URL }> {
  const request = await startSignIn(config, interaction === 'silent' ? 'none' : 'default');
  const destination = redirectLocation(
    await fetch(request.authorizationUrl, {
      headers: { cookie },
      redirect: 'manual',
    }),
  );
  const callbackUrl =
    interaction === 'renew' &&
    destination.origin === issuer &&
    destination.pathname === '/oidc/consent'
      ? redirectLocation(await submitInteraction(destination, cookie, { intent: 'allow' }))
      : destination;
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(callback);
  return { request, callbackUrl };
}

async function expectSilentSignInError(
  request: LoginRequest,
  cookie: string,
  error: 'login_required' | 'consent_required',
): Promise<void> {
  const response = await fetch(request.authorizationUrl, {
    headers: { cookie },
    redirect: 'manual',
  });
  const destination = redirectLocation(response);
  expect(destination.origin + destination.pathname).toBe(callback);
  expect(destination.searchParams.get('state')).toBe(request.state);
  expect(destination.searchParams.get('iss')).toBe(issuer);
  expect(destination.searchParams.get('error')).toBe(error);
  expect(destination.searchParams.get('code')).toBeNull();
}

async function verifyReauthentication(config: oidc.Configuration, cookie: string): Promise<void> {
  await expectSilentSignInError(await startSignIn(config, 'none'), '', 'login_required');
  const fresh = await startSignIn(config, 'none');
  fresh.authorizationUrl.searchParams.set('max_age', '0');
  await expectSilentSignInError(fresh, cookie, 'login_required');

  const forced = await startSignIn(config, 'login');
  const response = await fetch(forced.authorizationUrl, {
    headers: { cookie },
    redirect: 'manual',
  });
  const destination = redirectLocation(response);
  expect(destination.origin + destination.pathname).toBe(`${issuer}/oidc/login`);
}

type AuthenticatedClient = {
  config: oidc.Configuration;
  cookie: string;
};

async function verifyUserInfo(
  config: oidc.Configuration,
  accessToken: string,
  subject: string,
): Promise<void> {
  const endpoint = `${issuer}/api/auth/oauth2/userinfo`;
  expect(config.serverMetadata().userinfo_endpoint).toBe(endpoint);
  expect(await oidc.fetchUserInfo(config, accessToken, subject)).toEqual({ sub: subject });
  const posted = await fetch(endpoint, {
    method: 'POST',
    body: new URLSearchParams({ access_token: accessToken }),
  });
  expect(posted.status).toBe(success);
  expect(posted.headers.get('cache-control')).toBe('no-store');
  expect(await posted.json()).toEqual({ sub: subject });
  const bearerPost = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(bearerPost.status).toBe(success);
  expect(await bearerPost.json()).toEqual({ sub: subject });
  const missing = await fetch(endpoint);
  expect(missing.status).toBe(unauthorized);
  expect(missing.headers.get('www-authenticate')).toMatch(/^Bearer/u);
}

async function verifyRevocation(
  database: Database,
  member: CredentialedMember,
  session: AuthenticatedClient,
  accessToken: string,
): Promise<void> {
  const { config, cookie } = session;
  const { app, actorId, memberId } = member;
  await verifyUserInfo(config, accessToken, actorId);
  const manager = {
    actorId,
    installationId: app.installationId,
  };
  await saveApplicationRole(database, manager, {
    key: 'reader',
    permissionKeys: [],
  });
  expect(await oidc.tokenIntrospection(config, accessToken)).toMatchObject({
    active: true,
    permissions: [],
  });
  const warm = await startWarmSignIn(config, cookie);
  const priorGrant = await startWarmSignIn(config, cookie);
  await changeApplicationAssignment(database, manager, {
    action: 'revoke',
    memberId,
  });
  expect(await oidc.tokenIntrospection(config, accessToken)).toEqual({ active: false });
  await expect(oidc.fetchUserInfo(config, accessToken, actorId)).rejects.toMatchObject({
    status: unauthorized,
  });
  await expect(exchange(config, warm.callbackUrl, warm.request)).rejects.toMatchObject({
    error: 'invalid_grant',
  });
  const denied = await fetch(warm.request.authorizationUrl, {
    headers: { cookie },
    redirect: 'manual',
  });
  expect(denied.status).toBe(forbidden);
  await changeApplicationAssignment(database, manager, {
    action: 'grant',
    memberId,
    roleKeys: [],
  });
  expect(await oidc.tokenIntrospection(config, accessToken)).toEqual({ active: false });
  await expect(exchange(config, priorGrant.callbackUrl, priorGrant.request)).rejects.toMatchObject({
    error: 'invalid_grant',
  });
}

async function verifyTokenAndSessionRevocation(
  config: oidc.Configuration,
  cookie: string,
): Promise<void> {
  await expectSilentSignInError(await startSignIn(config, 'none'), cookie, 'consent_required');
  const first = await startWarmSignIn(config, cookie, 'renew');
  const revoked = await exchange(config, first.callbackUrl, first.request);
  await oidc.tokenRevocation(config, revoked.access_token);
  expect(await oidc.tokenIntrospection(config, revoked.access_token)).toEqual({ active: false });

  const second = await startWarmSignIn(config, cookie, 'silent');
  const sessionToken = await exchange(config, second.callbackUrl, second.request);
  const authTime = sessionToken.claims()?.auth_time;
  expect(authTime).toEqual(expect.any(Number));
  expect(authTime).toBe(revoked.claims()?.auth_time);
  await verifyReauthentication(config, cookie);
  const signOut = await fetch(`${issuer}/api/signout`, {
    method: 'POST',
    headers: {
      cookie,
      origin: issuer,
    },
  });
  expect(signOut.status).toBe(success);
  expect(await oidc.tokenIntrospection(config, sessionToken.access_token)).toEqual({
    active: false,
  });
}

test.skipIf(!configuredIssuer || !databasePort)(
  'registered app completes hosted OIDC sign-in',
  async () => {
    const database = createDatabase({
      host: '127.0.0.1',
      port: databasePort,
      user: 'iam',
      password: 'disposable',
      database: 'iam',
      ssl: false,
      logger: false,
    });
    const slug = randomUUID();
    const email = `${slug}@example.test`;

    try {
      const member = await provisionApplication(database, slug, email);
      const { app, actorId } = member;
      const config = await discoverApplication(app);
      const metadata = config.serverMetadata();
      expect(metadata).toMatchObject({
        id_token_signing_alg_values_supported: ['RS256'],
        claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'auth_time'],
      });
      const request = await startSignIn(config);
      const { callbackUrl, cookie } = await completeSignIn(request, email);
      const tokens = await exchange(config, callbackUrl, request);
      expect(tokens.claims()?.sub).toBe(actorId);
      expect(tokens.claims()?.iss).toBe(issuer);
      expect(tokens.claims()?.email).toBeUndefined();
      expect(Object.keys(tokens.claims() ?? {})).toEqual(
        expect.arrayContaining(metadata.claims_supported ?? []),
      );
      expect(tokens.refresh_token).toBeUndefined();

      const otherClient = await discoverApplication(member.otherApp);
      expect(await oidc.tokenIntrospection(otherClient, tokens.access_token)).toEqual({
        active: false,
      });
      const status = await oidc.tokenIntrospection(config, tokens.access_token);
      expect(status).toMatchObject({
        active: true,
        client_id: app.clientId,
        sub: actorId,
        permissions: ['reports.read'],
      });
      expect(status).not.toHaveProperty('sid');
      expect(status).not.toHaveProperty('iam_grant_version');
      await verifyRevocation(database, member, { config, cookie }, tokens.access_token);
      await verifyTokenAndSessionRevocation(config, cookie);
      const management = await fetch(`${issuer}/api/auth/admin/oauth2/create-client`, {
        method: 'POST',
      });
      expect(management.status).toBe(notFound);
    } finally {
      try {
        await removeFixture(database, slug, email);
      } finally {
        await database.$client.end();
      }
    }
  },
);

async function signInFixture(database: Database, email: string): Promise<string> {
  const auth = createAuth(database, {
    secret: process.env.AUTH_SECRET ?? '',
    url: issuer,
    webOrigin: issuer,
  });
  const session = await auth.api.signInEmail({
    returnHeaders: true,
    body: { email, password },
  });

  return sessionCookies(session.headers);
}

async function expectAppAccessDenied(config: oidc.Configuration, cookie: string): Promise<void> {
  const { authorizationUrl } = await startSignIn(config);
  const response = await fetch(authorizationUrl, {
    headers: { cookie },
    redirect: 'manual',
  });
  expect(response.status).toBe(forbidden);
  expect(response.headers.get('location')).toBeNull();
  await response.body?.cancel();
}

async function warmAppToken(config: oidc.Configuration, cookie: string): Promise<string> {
  const signIn = await startWarmSignIn(config, cookie, 'renew');
  const token = await exchange(config, signIn.callbackUrl, signIn.request);
  return token.access_token;
}

async function verifyClientAuthenticationMethods(
  reports: Application,
  billing: Application,
  client: oidc.Configuration,
  token: string,
): Promise<void> {
  const metadata = client.serverMetadata();
  const methods = ['client_secret_basic', 'client_secret_post'];
  expect(metadata.token_endpoint_auth_methods_supported).toEqual(methods);
  expect(metadata.introspection_endpoint_auth_methods_supported).toEqual(methods);
  expect(metadata.revocation_endpoint_auth_methods_supported).toEqual(methods);
  const postUsingBasic = await discoverApplication({
    ...billing,
    tokenEndpointAuthMethod: 'client_secret_basic',
  });
  await expect(oidc.tokenIntrospection(postUsingBasic, token)).rejects.toMatchObject({
    status: unauthorized,
    code: 'OAUTH_WWW_AUTHENTICATE_CHALLENGE',
  });
  expect(reports.tokenEndpointAuthMethod).toBe('client_secret_basic');
  const basicUsingPost = await discoverApplication({
    ...reports,
    tokenEndpointAuthMethod: 'client_secret_post',
  });
  await expect(oidc.tokenIntrospection(basicUsingPost, token)).rejects.toMatchObject({
    error: 'invalid_client',
  });
}

async function verifyTenantIsolation(
  database: Database,
  reports: CredentialedMember,
  billing: CredentialedMember,
  cookie: string,
): Promise<void> {
  const auth = createAuth(database, {
    secret: process.env.AUTH_SECRET ?? '',
    url: issuer,
    webOrigin: issuer,
  });
  const member = await auth.api.addMember({
    body: {
      userId: reports.actorId,
      organizationId: billing.organizationId,
      role: 'member',
    },
  });
  const reportsClient = await discoverApplication(reports.app);
  const billingClient = await discoverApplication(billing.app);
  const reportsToken = await warmAppToken(reportsClient, cookie);
  await expectAppAccessDenied(billingClient, cookie);

  const billingManager = {
    actorId: billing.actorId,
    installationId: billing.app.installationId,
  };
  await changeApplicationAssignment(database, billingManager, {
    action: 'grant',
    memberId: member.id,
    roleKeys: ['reader'],
  });
  const billingToken = await warmAppToken(billingClient, cookie);
  expect(await oidc.tokenIntrospection(billingClient, billingToken)).toMatchObject({
    active: true,
    sub: reports.actorId,
    permissions: ['billing.read'],
  });
  expect(await oidc.tokenIntrospection(billingClient, reportsToken)).toEqual({ active: false });
  expect(await oidc.tokenIntrospection(reportsClient, billingToken)).toEqual({ active: false });
  await verifyClientAuthenticationMethods(reports.app, billing.app, billingClient, billingToken);

  await changeApplicationAssignment(database, billingManager, {
    action: 'revoke',
    memberId: member.id,
  });
  expect(await oidc.tokenIntrospection(billingClient, billingToken)).toEqual({ active: false });
  await oidc.tokenRevocation(billingClient, billingToken);
  await expectAppAccessDenied(billingClient, cookie);
  expect(await oidc.tokenIntrospection(reportsClient, reportsToken)).toMatchObject({
    active: true,
    sub: reports.actorId,
    permissions: ['reports.read'],
  });
}

test.skipIf(!configuredIssuer || !databasePort || !process.env.AUTH_SECRET)(
  'each private app requires its own grant for an account in two organizations',
  async () => {
    const database = createDatabase({
      host: '127.0.0.1',
      port: databasePort,
      user: 'iam',
      password: 'disposable',
      database: 'iam',
      ssl: false,
      logger: false,
    });
    const reportsSlug = randomUUID();
    const billingSlug = randomUUID();
    const reportsEmail = `${reportsSlug}@example.test`;
    const billingEmail = `${billingSlug}@example.test`;

    try {
      const reports = await provisionApplication(database, reportsSlug, reportsEmail);
      const billing = await provisionApplication(database, billingSlug, billingEmail, {
        permissionKey: 'billing.read',
        tokenEndpointAuthMethod: 'client_secret_post',
      });
      const cookie = await signInFixture(database, reportsEmail);
      await verifyTenantIsolation(database, reports, billing, cookie);
    } finally {
      try {
        await removeFixture(database, billingSlug, billingEmail);
      } finally {
        try {
          await removeFixture(database, reportsSlug, reportsEmail);
        } finally {
          await database.$client.end();
        }
      }
    }
  },
);

type SuspensionFixture = {
  organizationId: string;
  ownerMemberId: string;
  memberId: string;
  adminCookie: string;
  memberCookie: string;
};

async function provisionSuspension(
  database: Database,
  app: Application,
  ownerEmail: string,
  memberEmail: string,
): Promise<SuspensionFixture> {
  const auth = createAuth(database, {
    secret: process.env.AUTH_SECRET ?? '',
    url: issuer,
    webOrigin: issuer,
  });
  const owner = await auth.api.signInEmail({
    returnHeaders: true,
    body: {
      email: ownerEmail,
      password,
    },
  });
  const adminId = owner.response.user.id;
  const [{ id: ownerMemberId, organization_id: organizationId }] = await database.$client<
    { id: string; organization_id: string }[]
  >`
    select id, organization_id from iam.members where user_id = ${adminId}
  `;
  const actor = await provisionActor(database, auth, memberEmail, 'Assigned member');
  const { userId, cookie: memberCookie } = actor;
  const member = await auth.api.addMember({
    body: {
      userId,
      organizationId,
      role: 'member',
    },
  });
  await changeApplicationAssignment(
    database,
    {
      actorId: adminId,
      installationId: app.installationId,
    },
    {
      action: 'grant',
      memberId: member.id,
      roleKeys: ['reader'],
    },
  );
  return {
    organizationId,
    ownerMemberId,
    memberId: member.id,
    adminCookie: sessionCookies(owner.headers),
    memberCookie,
  };
}

async function markOwnerPasskey(database: Database, ownerEmail: string): Promise<void> {
  const passkeyId = randomUUID();
  await database.$client.begin(async (transaction) => {
    await transaction`insert into iam.passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up)
      select ${passkeyId}, id, ${randomUUID()}, 'test fixture', 0, 'singleDevice', false
      from iam.users where email = ${ownerEmail}`;
    await transaction`update iam.sessions set admin_passkey_id = ${passkeyId}, admin_verified_at = now()
      where user_id in (select id from iam.users where email = ${ownerEmail})`;
  });
}

function routeProtocolTo(config: oidc.Configuration, targetOrigin: string): oidc.Configuration {
  config[oidc.customFetch] = async (input, options): Promise<Response> => {
    const endpoint = new URL(input);
    if (endpoint.origin !== issuer) {
      throw new Error('Expected the canonical fixture issuer');
    }

    const target = new URL(targetOrigin);
    target.pathname = endpoint.pathname;
    target.search = endpoint.search;
    const { body, ...request } = options;

    if (body && !(body instanceof URLSearchParams)) {
      throw new Error('Expected a form body for the fixture protocol request');
    }

    return fetch(target, { ...request, body });
  };
  return config;
}

async function rotateThroughIam(app: Application, cookie: string): Promise<Application> {
  const response = await submitAdminOperation(issuer, cookie, {
    action: 'manage-client',
    operation: 'rotate-secret',
    clientId: app.clientId,
  });
  expect(response.status).toBe(success);
  const result = valibot.parse(
    valibot.object({
      action: valibot.literal('rotate-secret'),
      clientSecret: valibot.pipe(valibot.string(), valibot.nonEmpty()),
    }),
    await response.json(),
  );

  return {
    ...app,
    clientSecret: result.clientSecret,
  };
}

async function verifyPilotRollback(
  database: Database,
  member: CredentialedMember,
  session: RollbackSession,
): Promise<void> {
  const { app, otherApp, actorId, memberId } = member;
  const { cookie } = session;
  await changeApplicationAssignment(
    database,
    {
      actorId,
      installationId: otherApp.installationId,
    },
    {
      action: 'grant',
      memberId,
      roleKeys: [],
    },
  );
  await containPilot(database, issuer, member, session);

  const disabledClient = await discoverApplication(app);
  const signIn = await startSignIn(disabledClient);
  const denial = redirectLocation(
    await fetch(signIn.authorizationUrl, {
      headers: { cookie },
      redirect: 'manual',
    }),
  );
  expect(denial.origin).toBe(issuer);
  expect(denial.searchParams.get('error')).toBe('client_disabled');
  expect(denial.searchParams.get('code')).toBeNull();

  const controlClient = await discoverApplication(otherApp);
  const control = await startWarmSignIn(controlClient, cookie, 'renew');
  expect(control.callbackUrl.searchParams.get('code')).toBeTruthy();
}

async function verifyReplicaChanges(
  database: Database,
  member: CredentialedMember,
  email: string,
  origins: { replica: string; unavailable: string },
): Promise<void> {
  const { app, actorId } = member;
  const primary = await discoverApplication(app);
  const secondary = routeProtocolTo(await discoverApplication(app), origins.replica);
  const replicas = [primary, secondary];
  const cookie = await signInFixture(database, email);
  const { callbackUrl, request } = await startWarmSignIn(primary, cookie, 'renew');
  const token = await exchange(secondary, callbackUrl, request);
  const initial = await Promise.all(
    replicas.map(async (config) => oidc.tokenIntrospection(config, token.access_token)),
  );

  for (const status of initial) {
    expect(status).toMatchObject({
      active: true,
      permissions: ['reports.read'],
      sub: actorId,
    });
  }

  const unavailable = routeProtocolTo(await discoverApplication(app), origins.unavailable);
  await expect(oidc.tokenIntrospection(unavailable, token.access_token)).rejects.toMatchObject({
    cause: { status: serviceUnavailable },
  });
  await saveApplicationRole(
    database,
    {
      actorId,
      installationId: app.installationId,
    },
    {
      key: 'reader',
      permissionKeys: [],
    },
  );
  const updated = await Promise.all(
    replicas.map(async (config) => oidc.tokenIntrospection(config, token.access_token)),
  );

  for (const status of updated) {
    expect(status).toMatchObject({
      active: true,
      permissions: [],
    });
  }

  await markOwnerPasskey(database, email);
  const rotated = await rotateThroughIam(app, cookie);
  await Promise.all(
    replicas.map(async (config) =>
      expect(oidc.tokenIntrospection(config, token.access_token)).rejects.toMatchObject({
        code: 'OAUTH_WWW_AUTHENTICATE_CHALLENGE',
        status: unauthorized,
      }),
    ),
  );
  const rotatedPrimary = await discoverApplication(rotated);
  const rotatedSecondary = routeProtocolTo(await discoverApplication(rotated), origins.replica);
  expect(await oidc.tokenIntrospection(rotatedSecondary, token.access_token)).toEqual({
    active: false,
  });
  const next = await startWarmSignIn(rotatedSecondary, cookie, 'renew');
  const fresh = await exchange(rotatedSecondary, next.callbackUrl, next.request);
  await verifyPilotRollback(database, member, {
    replicas: [rotatedPrimary, rotatedSecondary],
    cookie,
    accessToken: fresh.access_token,
  });
}

test.skipIf(
  !configuredIssuer ||
    !databasePort ||
    !process.env.AUTH_SECRET ||
    !replicaOrigin ||
    !unavailableOrigin,
)(
  'IAM replicas enforce current permissions, fail closed on outage, and contain pilot rollback',
  async () => {
    const database = createDatabase({
      host: '127.0.0.1',
      port: databasePort,
      user: 'iam',
      password: 'disposable',
      database: 'iam',
      ssl: false,
      logger: false,
    });
    const slug = randomUUID();
    const email = `${slug}@example.test`;

    try {
      await verifyReplicaSigningKey(database, [issuer, replicaOrigin ?? '']);
      const member = await provisionApplication(database, slug, email);
      await verifyReplicaChanges(database, member, email, {
        replica: replicaOrigin ?? '',
        unavailable: unavailableOrigin ?? '',
      });
    } finally {
      try {
        await removeFixture(database, slug, email);
      } finally {
        await database.$client.end();
      }
    }
  },
);

type StatusChange = { memberId: string; status: 'active' | 'suspended' };

async function setMemberStatus(
  fixture: SuspensionFixture,
  change: StatusChange,
): Promise<Response> {
  return fetch(`${issuer}/api/auth/admin/member-status`, {
    method: 'POST',
    headers: {
      origin: issuer,
      cookie: fixture.adminCookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organizationId: fixture.organizationId,
      ...change,
    }),
  });
}

async function verifySuspendedGrant(
  config: oidc.Configuration,
  fixture: SuspensionFixture,
): Promise<void> {
  const signIn = await startWarmSignIn(config, fixture.memberCookie, 'renew');
  const tokens = await exchange(config, signIn.callbackUrl, signIn.request);
  const outstanding = await startWarmSignIn(config, fixture.memberCookie);
  const suspended = await setMemberStatus(fixture, {
    memberId: fixture.memberId,
    status: 'suspended',
  });
  expect(suspended.status).toBe(success);
  expect(await oidc.tokenIntrospection(config, tokens.access_token)).toEqual({ active: false });
  const denied = await fetch(outstanding.request.authorizationUrl, {
    headers: { cookie: fixture.memberCookie },
    redirect: 'manual',
  });
  expect(denied.status).toBe(forbidden);
  const reinstated = await setMemberStatus(fixture, {
    memberId: fixture.memberId,
    status: 'active',
  });
  expect(reinstated.status).toBe(success);
  expect(await oidc.tokenIntrospection(config, tokens.access_token)).toEqual({ active: false });
  await expect(
    exchange(config, outstanding.callbackUrl, outstanding.request),
  ).rejects.toMatchObject({
    error: 'invalid_grant',
  });
  const fresh = await startWarmSignIn(config, fixture.memberCookie, 'renew');
  const freshTokens = await exchange(config, fresh.callbackUrl, fresh.request);
  expect(await oidc.tokenIntrospection(config, freshTokens.access_token)).toMatchObject({
    active: true,
    permissions: ['reports.read'],
  });
}

test.skipIf(!configuredIssuer || !databasePort || !process.env.AUTH_SECRET)(
  'membership suspension retires existing OIDC grants across reinstatement',
  async () => {
    const database = createDatabase({
      host: '127.0.0.1',
      port: databasePort,
      user: 'iam',
      password: 'disposable',
      database: 'iam',
      ssl: false,
      logger: false,
    });
    const slug = randomUUID();
    const email = `${slug}@example.test`;
    const memberEmail = `member-${slug}@example.test`;

    try {
      const { app } = await provisionApplication(database, slug, email);
      const fixture = await provisionSuspension(database, app, email, memberEmail);
      const target = {
        memberId: fixture.memberId,
        status: 'suspended',
      } satisfies StatusChange;
      const unverified = await setMemberStatus(fixture, target);
      expect(unverified.status).toBe(forbidden);
      expect(await unverified.json()).toMatchObject({ code: 'PASSKEY_REQUIRED' });
      await markOwnerPasskey(database, email);
      const owner = await setMemberStatus(fixture, {
        ...target,
        memberId: fixture.ownerMemberId,
      });
      expect(await owner.json()).toMatchObject({ code: 'ORGANIZATION_MEMBER_UNAVAILABLE' });
      const config = await discoverApplication(app);
      await verifySuspendedGrant(config, fixture);
    } finally {
      try {
        await removeFixture(database, slug, email);
        await database.$client`delete from iam.users where email = ${memberEmail}`;
      } finally {
        await database.$client.end();
      }
    }
  },
);
