import { randomUUID } from 'node:crypto';
import * as oidc from 'openid-client';
import { ClientSecretBasic as clientSecretBasic } from 'openid-client';
import * as valibot from 'valibot';

const seeOther = 303;
const ok = 200;
const badRequest = 400;
const unauthorized = 401;
const forbidden = 403;
const unavailable = 503;
const notFound = 404;

type ClientOptions = {
  origin: string;
  issuer: string;
  introspectionEndpoint: string;
  name: string;
  credentials: { clientId: string; clientSecret: string };
  requiredPermission: string;
};

type Login = { state: string; nonce: string; verifier: string };
type Session = { token: string; subject: string; idToken: string };
const permissionSchema = valibot.object({
  active: valibot.literal(true),
  permission: valibot.string(),
});

function cookieValue(request: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function redirect(url: string, name: string, value: string): Response {
  return new Response(null, {
    status: seeOther,
    headers: {
      location: url,
      'set-cookie': `${name}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/`,
      'cache-control': 'no-store',
    },
  });
}

async function serveProtected(
  introspection: oidc.Configuration,
  requiredPermission: string,
  session: Session | undefined,
): Promise<Response> {
  if (!session) {
    return new Response(null, { status: unauthorized });
  }
  try {
    const result = valibot.safeParse(
      permissionSchema,
      await oidc.tokenIntrospection(introspection, session.token, {
        token_type_hint: 'access_token',
      }),
    );
    if (!result.success || result.output.permission !== requiredPermission) {
      return new Response(null, { status: forbidden });
    }
    return new Response(result.output.permission, { status: ok });
  } catch {
    return new Response(null, { status: unavailable });
  }
}

/**
 * Create a confidential OIDC client with a server-owned session.
 * @param {ClientOptions} options - Client registration and policy endpoint.
 * @returns {Promise<object>} A fixture request handler and its observed sessions.
 */
export async function createClient(options: ClientOptions): Promise<{
  handle: (request: Request) => Promise<Response>;
  configuration: oidc.Configuration;
  sessions: ReadonlyMap<string, Session>;
}> {
  const { origin, issuer, introspectionEndpoint, name, credentials, requiredPermission } = options;
  const { clientId, clientSecret } = credentials;
  const callback = new URL('/callback', origin).href;
  const authorization = clientSecretBasic(clientSecret);
  const configuration = await oidc.discovery(
    new URL(issuer),
    clientId,
    clientSecret,
    authorization,
    {
      execute: [oidc.enableNonRepudiationChecks],
    },
  );
  const introspection = new oidc.Configuration(
    {
      issuer,
      introspection_endpoint: introspectionEndpoint,
    },
    clientId,
    clientSecret,
    authorization,
  );

  const logins = new Map<string, Login>();
  const sessions = new Map<string, Session>();
  const loginCookie = `__Host-login-${clientId}`;
  const sessionCookie = `__Host-session-${clientId}`;

  async function completeSignIn(request: Request, url: URL): Promise<Response> {
    const loginId = cookieValue(request, loginCookie) ?? '';
    const login = logins.get(loginId);
    logins.delete(loginId);
    if (!login) {
      return new Response('Sign-in transaction missing', { status: badRequest });
    }
    try {
      const tokens = await oidc.authorizationCodeGrant(configuration, url, {
        pkceCodeVerifier: login.verifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      });
      const subject = tokens.claims()?.sub;
      if (!subject || !tokens.id_token) {
        return new Response('ID token missing', { status: badRequest });
      }
      const sessionId = randomUUID();
      sessions.set(sessionId, {
        token: tokens.access_token,
        subject,
        idToken: tokens.id_token,
      });
      return redirect(origin, sessionCookie, sessionId);
    } catch {
      return new Response('Authorization was rejected', { status: badRequest });
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const session = sessions.get(cookieValue(request, sessionCookie) ?? '');
    if (url.pathname === '/') {
      return new Response(session ? `${name} session` : '<a href="/sign-in">Sign in with IAM</a>', {
        status: ok,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (url.pathname === '/sign-in') {
      const loginId = randomUUID();
      const login = {
        verifier: oidc.randomPKCECodeVerifier(),
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
      };
      logins.set(loginId, login);
      const destination = oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: callback,
        scope: 'openid',
        state: login.state,
        nonce: login.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(login.verifier),
        code_challenge_method: 'S256',
      });
      return redirect(destination.href, loginCookie, loginId);
    }
    if (url.pathname === '/callback') {
      return completeSignIn(request, url);
    }
    if (url.pathname === '/protected') {
      return serveProtected(introspection, requiredPermission, session);
    }
    return new Response(null, { status: notFound });
  }

  return { handle, configuration, sessions };
}
