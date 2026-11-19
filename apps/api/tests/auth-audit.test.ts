import { H3 } from 'nitro/h3';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import authHandler from '../server/api/auth/[...all].ts';

const { handler } = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('@iam/auth', () => ({
  useAuth: vi.fn().mockReturnValue({
    handler,
    $context: Promise.resolve({
      baseURL: 'http://localhost:3000/api/auth',
      isTrustedOrigin: (origin: string) =>
        origin === 'http://localhost:3000' || origin === 'http://localhost:5176',
    }),
  }),
}));

const app = new H3().all('/api/auth/**', authHandler);
const signInUrl = 'http://localhost:3000/api/auth/sign-in/email';
const recoveryUrl = 'http://localhost:3000/api/auth/account/password-recovery';
const userId = 'c2554b8f-8ac8-4bd3-b22a-1834509b6338';
const user = {
  id: userId,
  email: 'audit-test@example.test',
  name: 'Audit fixture',
  emailVerified: true,
};
const password = 'audit-test-password';
const token = 'audit-test-token';
const cookie = 'better-auth.session_token=audit-test-cookie; HttpOnly';
const callerRequestId = 'caller-selected-id';
const uuidPattern = /^[\da-f-]{36}$/u;
const ok = 200;
const unauthorized = 401;
const badRequest = 400;
const tooManyRequests = 429;
const unavailable = 503;

afterEach(() => {
  handler.mockReset();
  vi.restoreAllMocks();
});

test('preserves OAuth form encoding and forwards the runtime client IP', async () => {
  handler.mockImplementation(async (request: Request): Promise<Response> => {
    const form = await request.formData();
    return Response.json({
      token: form.get('token'),
      clientIp: request.headers.get('X-Forwarded-For'),
    });
  });

  const clientIp = '192.0.2.21';
  const request = new Request('http://localhost:3000/api/auth/oauth2/introspect', {
    method: 'POST',
    body: new URLSearchParams({ token }),
  });
  const response = await app.fetch(
    Object.assign(request, { context: { clientAddress: clientIp } }),
  );

  expect(response.status).toBe(ok);
  expect(await response.json()).toEqual({ token, clientIp });
});

test.each([
  [ok, 'succeeded', userId],
  [unauthorized, 'denied', null],
  [tooManyRequests, 'throttled', null],
  [unavailable, 'error', null],
] satisfies [number, string, string | null][])(
  'records a redacted sign-in event for HTTP %s',
  async (status, outcome, actorId) => {
    const audit = vi.spyOn(console, 'info').mockImplementation(vi.fn());
    const body = { user, token };
    handler.mockResolvedValue(
      Response.json(body, {
        status,
        headers: { 'Set-Cookie': cookie },
      }),
    );
    const response = await app.fetch(
      new Request(signInUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': callerRequestId,
        },
        body: JSON.stringify({
          email: user.email,
          password,
        }),
      }),
    );
    expect(response.status).toBe(status);
    expect(response.headers.getSetCookie()).toEqual(status === unauthorized ? [] : [cookie]);
    const result: unknown = await response.json();

    if (status === ok) {
      expect(result).toEqual({ user });
    } else if (status === unauthorized) {
      expect(result).toEqual({
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      });
    } else {
      expect(result).toEqual(body);
    }

    const requestId = response.headers.get('X-Request-ID');
    expect(requestId).toMatch(uuidPattern);
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.any(String));
    const [[line]] = audit.mock.calls;
    const event: unknown = JSON.parse(String(line));
    const timestamp: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);
    expect(event).toEqual({
      event: 'AUTH_EMAIL_SIGN_IN',
      timestamp,
      requestId,
      status,
      outcome,
      userId: actorId,
    });
  },
);

test.each([
  [ok, 'accepted', { accepted: true }],
  [ok, 'succeeded', { reset: true }],
  [badRequest, 'denied', { code: 'RECOVERY_CODE_INVALID' }],
  [tooManyRequests, 'throttled', { code: 'TOO_MANY_REQUESTS' }],
  [unavailable, 'error', { code: 'SERVICE_UNAVAILABLE' }],
] satisfies [number, string, object][])(
  'records a redacted password recovery event for %s %s',
  async (status, outcome, body) => {
    const audit = vi.spyOn(console, 'info').mockImplementation(vi.fn());
    handler.mockResolvedValue(Response.json(body, { status }));
    const payload = JSON.stringify({
      action: 'reset',
      email: user.email,
      code: '00000000',
      password,
    });
    const response = await app.fetch(
      new Request(recoveryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
          Origin: 'http://localhost:3000',
          'X-Request-ID': callerRequestId,
        },
        body: payload,
      }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    const requestId = response.headers.get('X-Request-ID');
    expect(requestId).toMatch(uuidPattern);
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.any(String));
    const [[line]] = audit.mock.calls;
    const event: unknown = JSON.parse(String(line));
    const timestamp: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);
    expect(event).toEqual({
      event: 'AUTH_PASSWORD_RECOVERY',
      timestamp,
      requestId,
      status,
      outcome,
      userId: null,
    });
  },
);
