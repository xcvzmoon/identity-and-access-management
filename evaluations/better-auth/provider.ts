import type { BetterAuthOptions } from 'better-auth';
import type { Jwk } from 'better-auth/plugins/jwt';
import type { Pool } from 'pg';
import { getCurrentAuthEndpointContext } from '@better-auth/core/context';
import {
  getOAuthProviderState,
  oauthProvider,
  oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider';
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { APIError, getSessionFromCtx } from 'better-auth/api';
import { jwt } from 'better-auth/plugins/jwt';
import * as valibot from 'valibot';

const firstRow = 0;
const authPath = '/auth';
const keyGraceSeconds = 3600;
const shortTokenLifetimeSeconds = 300;
const consoleReference = 'console';
const managementPermission = 'organization.manage';
const forbidden = 403;
const ok = 200;
const badRequest = 400;

type ProviderOptions = {
  pool: Pool;
  issuer: string;
  secret: string;
  verificationEmails: Map<string, string>;
  resetEmails: Map<string, string>;
  operatorEmail: string;
};

const authorizeSchema = valibot.object({
  client_id: valibot.string(),
  redirect_uri: valibot.string(),
});
const introspectionSchema = valibot.object({
  active: valibot.literal(true),
  client_id: valibot.string(),
  sub: valibot.string(),
  sid: valibot.string(),
  iam_grant_version: valibot.string(),
});
const stepUpSchema = valibot.object({
  session: valibot.object({
    id: valibot.string(),
    userId: valibot.string(),
  }),
  user: valibot.object({ id: valibot.string() }),
});

async function initializePolicy(pool: Pool): Promise<void> {
  await pool.query(`
    create table evaluation_clients (
      id text primary key,
      name text not null,
      organization text,
      callback text not null
    );
    create table evaluation_grants (
      client_id text not null references evaluation_clients(id),
      user_id text not null,
      version text not null,
      permission text not null,
      primary key (client_id, user_id)
    );
    create table evaluation_audit (
      client_id text not null,
      organization text,
      user_id text not null,
      outcome text not null,
      recorded_at timestamptz not null default now()
    );
    create table evaluation_keys (
      id uuid primary key default gen_random_uuid(),
      "publicKey" text not null,
      "privateKey" text not null,
      "createdAt" timestamptz not null default clock_timestamp(),
      "expiresAt" timestamptz,
      alg text not null
    );
    create unique index evaluation_one_signer on evaluation_keys (alg) where "expiresAt" is null;
    create table evaluation_invitations (
      id uuid primary key default gen_random_uuid(),
      organization text not null,
      email text not null,
      expires_at timestamptz not null,
      accepted_at timestamptz
    );
    create table evaluation_memberships (
      organization text not null,
      user_id text not null,
      role text not null default 'member',
      primary key (organization, user_id)
    );
    create table evaluation_step_up (
      session_id text primary key,
      user_id text not null,
      verified_at timestamptz not null default now()
    );
  `);
}

async function grantFor(
  pool: Pool,
  clientId: string,
  userId: string,
  callback?: string,
): Promise<
  { organization: string | null; version: string | null; permission: string | null } | undefined
> {
  const { rows } = await pool.query<{
    organization: string | null;
    version: string | null;
    permission: string | null;
  }>(
    `select client.organization, grant_row.version, grant_row.permission
     from evaluation_clients client
     left join evaluation_memberships membership
       on membership.organization = client.organization and membership.user_id = $2
     left join evaluation_grants grant_row
       on grant_row.client_id = client.id and grant_row.user_id = membership.user_id
     where client.id = $1 and ($3::text is null or client.callback = $3)`,
    [clientId, userId, callback ?? null],
  );
  return rows.at(firstRow);
}

async function authorizationQuery(): Promise<valibot.InferOutput<typeof authorizeSchema>> {
  const context = getCurrentAuthEndpointContext();
  if (context.path === '/oauth2/consent') {
    const state = await getOAuthProviderState();
    return valibot.parse(authorizeSchema, Object.fromEntries(new URLSearchParams(state?.query)));
  }
  return valibot.parse(authorizeSchema, context.query);
}

function signingPlugin(pool: Pool, issuer: string): ReturnType<typeof jwt> {
  return jwt({
    disableSettingJwtHeader: true,
    jwt: { issuer },
    jwks: {
      keyPairConfig: { alg: 'RS256' },
      gracePeriod: keyGraceSeconds,
    },
    adapter: {
      getJwks: async () => {
        const result = await pool.query<Jwk>('select * from evaluation_keys');
        return result.rows;
      },
      createJwk: async (candidate) => {
        const { rows } = await pool.query<Jwk>(
          `insert into evaluation_keys ("publicKey", "privateKey", alg) values ($1, $2, $3)
           on conflict (alg) where "expiresAt" is null do update set alg = excluded.alg
           returning *`,
          [candidate.publicKey, candidate.privateKey, candidate.alg],
        );
        const key = rows.at(firstRow);
        if (!key) {
          throw new Error('The key store returned no signing key.');
        }
        return key;
      },
    },
  });
}

type GrantClaims = { iam_grant_version: string | undefined };

function oauthPlugin(pool: Pool, operatorEmail: string): ReturnType<typeof oauthProvider> {
  return oauthProvider({
    loginPage: '/sign-in',
    consentPage: '/consent',
    scopes: ['openid'],
    grantTypes: ['authorization_code'],
    allowDynamicClientRegistration: false,
    clientPrivileges: ({ user }) => user?.emailVerified === true && user.email === operatorEmail,
    accessTokenExpiresIn: shortTokenLifetimeSeconds,
    postLogin: {
      page: '/sign-in',
      shouldRedirect: () => false,
      consentReferenceId: async ({ user }) => {
        const { client_id: clientId, redirect_uri: callback } = await authorizationQuery();
        const grant = await grantFor(pool, clientId, user.id, callback);
        if (grant?.organization === null) {
          return consoleReference;
        }
        if (!grant?.version) {
          if (grant) {
            await pool.query(
              `insert into evaluation_audit (client_id, organization, user_id, outcome)
               values ($1, $2, $3, 'denied')`,
              [clientId, grant.organization, user.id],
            );
          }
          throw new APIError('FORBIDDEN', { error: 'access_denied' });
        }
        return grant.version;
      },
    },
    customTokenResponseFields: async ({ user, verificationValue }) => {
      const query = valibot.safeParse(authorizeSchema, verificationValue?.query);
      if (!user || !query.success) {
        throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
      }
      const { client_id: clientId, redirect_uri: callback } = query.output;
      const grant = await grantFor(pool, clientId, user.id, callback);
      const reference = grant?.organization === null ? consoleReference : grant?.version;
      if (!reference || reference !== verificationValue?.referenceId) {
        throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
      }
      if (grant?.organization) {
        await pool.query(
          `insert into evaluation_audit (client_id, organization, user_id, outcome)
           values ($1, $2, $3, 'approved')`,
          [clientId, grant.organization, user.id],
        );
      }
      return {};
    },
    extensions: [
      {
        claims: {
          accessToken: ({ referenceId }): GrantClaims => ({
            iam_grant_version: referenceId,
          }),
        },
      },
    ],
  });
}

function passkeyPlugin(issuer: string): ReturnType<typeof passkey> {
  return passkey({
    rpID: new URL(issuer).hostname,
    rpName: 'IAM evaluation',
    origin: issuer,
    authenticatorSelection: { userVerification: 'required' },
    authentication: {
      afterVerification: async ({ ctx, clientData }) => {
        const priorSession = await getSessionFromCtx(ctx);
        const credential = await ctx.context.adapter.findOne<{ userId: string }>({
          model: 'passkey',
          where: [
            {
              field: 'credentialID',
              value: clientData.id,
            },
          ],
        });
        if (!priorSession?.user.emailVerified || credential?.userId !== priorSession.user.id) {
          throw new APIError('FORBIDDEN');
        }
      },
    },
  });
}

type ProviderConfiguration = BetterAuthOptions & {
  plugins: [
    ReturnType<typeof signingPlugin>,
    ReturnType<typeof oauthPlugin>,
    ReturnType<typeof passkeyPlugin>,
  ];
};
type Provider = ReturnType<typeof betterAuth<ProviderConfiguration>>;

async function storeMail(outbox: Map<string, string>, email: string, url: string): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(() => {
      outbox.set(email, url);
      resolve();
    });
  });
}

function createProvider({
  pool,
  issuer,
  secret,
  verificationEmails,
  resetEmails,
  operatorEmail,
}: ProviderOptions): Provider {
  return betterAuth<ProviderConfiguration>({
    baseURL: issuer,
    basePath: authPath,
    database: pool,
    secret,
    disabledPaths: ['/token', '/sign-up/email'],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await storeMail(resetEmails, user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await storeMail(verificationEmails, user.email, url);
      },
    },
    plugins: [signingPlugin(pool, issuer), oauthPlugin(pool, operatorEmail), passkeyPlugin(issuer)],
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
  });
}

async function finishStepUp(request: Request, auth: Provider, pool: Pool): Promise<Response> {
  const priorSession = await auth.api.getSession({ headers: request.headers });
  if (!priorSession?.user.emailVerified) {
    return new Response(null, { status: forbidden });
  }
  const response = await auth.handler(request);
  if (!response.ok) {
    return response;
  }
  const { session, user } = valibot.parse(stepUpSchema, await response.json());
  if (user.id !== priorSession.user.id || session.userId !== user.id) {
    return new Response(null, { status: forbidden });
  }
  await pool.query('insert into evaluation_step_up (session_id, user_id) values ($1, $2)', [
    session.id,
    user.id,
  ]);
  return new Response(null, { headers: response.headers });
}

async function hasStepUp(pool: Pool, sessionId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `select 1 from evaluation_step_up step_up
     join evaluation_memberships membership on membership.user_id = step_up.user_id
     where step_up.session_id = $1 and step_up.user_id = $2
       and membership.organization = 'North' and membership.role = 'owner'
       and step_up.verified_at > now() - interval '5 minutes'`,
    [sessionId, userId],
  );
  return Boolean(rowCount);
}

async function requireStepUp(request: Request, auth: Provider, pool: Pool): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const allowed =
    session?.user.emailVerified && (await hasStepUp(pool, session.session.id, session.user.id));
  return new Response(null, { status: allowed ? ok : forbidden });
}

async function handleProtocol(request: Request, auth: Provider, pool: Pool): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/.well-known/openid-configuration') {
    return oauthProviderOpenIdConfigMetadata(auth)(request);
  }
  if (pathname === `${authPath}/passkey/verify-authentication` && request.method === 'POST') {
    return finishStepUp(request, auth, pool);
  }
  const response = await auth.handler(request);
  if (pathname !== `${authPath}/oauth2/introspect` || !response.ok) {
    return response;
  }
  const result = valibot.safeParse(introspectionSchema, await response.json());
  const headers = { 'cache-control': 'no-store' };
  if (!result.success) {
    return Response.json({ active: false }, { headers });
  }
  const { client_id: clientId, sub, sid, iam_grant_version: version } = result.output;
  const grant = await grantFor(pool, clientId, sub);
  if (grant?.organization === null && version === consoleReference) {
    const allowed = await hasStepUp(pool, sid, sub);
    return Response.json(
      {
        active: true,
        sub,
        sid,
        permission: allowed ? managementPermission : 'account.read',
      },
      { headers },
    );
  }
  if (!grant?.permission || grant.version !== version) {
    return Response.json({ active: false }, { headers });
  }
  return Response.json(
    {
      active: true,
      sub,
      sid,
      permission: grant.permission,
    },
    { headers },
  );
}

const invitationForm = valibot.object({
  invitation: valibot.pipe(valibot.string(), valibot.uuid()),
  email: valibot.pipe(valibot.string(), valibot.email()),
  password: valibot.string(),
});

async function signUp(request: Request, auth: Provider, pool: Pool): Promise<Response> {
  const form = valibot.safeParse(invitationForm, await request.json());
  if (!form.success) {
    return new Response(null, { status: badRequest });
  }
  const { invitation, email, password } = form.output;
  const { rowCount } = await pool.query(
    `select 1 from evaluation_invitations
     where id = $1 and email = $2 and expires_at > now() and accepted_at is null`,
    [invitation, email],
  );
  if (!rowCount) {
    return new Response(null, { status: forbidden });
  }
  return auth.api.signUpEmail({
    headers: request.headers,
    body: {
      email,
      password,
      name: 'Invitee',
    },
    asResponse: true,
  });
}

async function acceptInvitation(request: Request, auth: Provider, pool: Pool): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const form = valibot.safeParse(
    valibot.pick(invitationForm, ['invitation']),
    await request.json(),
  );
  if (!form.success || !session?.user.emailVerified) {
    return new Response(null, { status: forbidden });
  }
  const { rowCount } = await pool.query(
    `with accepted as (
       update evaluation_invitations set accepted_at = now()
       where id = $1 and email = $2 and expires_at > now() and accepted_at is null
       returning organization
     )
     insert into evaluation_memberships (organization, user_id)
     select organization, $3 from accepted on conflict do nothing`,
    [form.output.invitation, session.user.email, session.user.id],
  );
  return new Response(null, { status: rowCount ? ok : forbidden });
}

export {
  acceptInvitation,
  authPath,
  createProvider,
  handleProtocol,
  initializePolicy,
  managementPermission,
  requireStepUp,
  signUp,
};
export type { Provider, ProviderOptions };
