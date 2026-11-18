import type { H3Event } from 'nitro/h3';
import { HTTPError } from 'nitro';
import { assertBodySize, readBody } from 'nitro/h3';
import { randomBytes } from 'node:crypto';
import * as valibot from 'valibot';
import {
  emailSignInPath,
  emailSignUpPath,
  maxAuthBodyBytes,
  postAuth,
  requireBrowserOrigin,
} from './auth-http.ts';

const email = valibot.pipe(valibot.string(), valibot.email());
const signInSchema = valibot.object({
  email,
  password: valibot.pipe(valibot.string(), valibot.nonEmpty()),
});
const signUpSchema = valibot.object({
  email,
  name: valibot.pipe(valibot.string(), valibot.nonEmpty()),
});
const signupSecretBytes = 32;
const serverError = 500;
const unavailable = 503;

async function completeBrowserAuth(response: Response): Promise<Response> {
  await response.body?.cancel();

  if (!response.ok) {
    const clientError = response.status < serverError;
    throw new HTTPError(clientError ? 'Authentication failed' : 'Authentication unavailable', {
      status: clientError ? response.status : unavailable,
    });
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });

  for (const cookie of response.headers.getSetCookie()) {
    headers.append('Set-Cookie', cookie);
  }

  return Response.json({}, { headers });
}

export async function authenticate(
  event: H3Event,
  action: 'sign-in' | 'sign-up',
): Promise<Response> {
  const origin = await requireBrowserOrigin(event);

  assertBodySize(event, maxAuthBodyBytes);

  const input = valibot.safeParse(
    action === 'sign-in' ? signInSchema : signUpSchema,
    await readBody(event),
  );

  if (!input.success) {
    throw new HTTPError('Invalid credentials input', { status: 400 });
  }

  const password =
    'password' in input.output
      ? input.output.password
      : randomBytes(signupSecretBytes).toString('base64url');
  const path = action === 'sign-in' ? emailSignInPath : emailSignUpPath;
  const response = await postAuth(event, path, new Headers({ origin }), {
    ...input.output,
    password,
  });

  return completeBrowserAuth(response);
}

export async function signOut(event: H3Event): Promise<Response> {
  const origin = await requireBrowserOrigin(event);
  const headers = new Headers({ origin });

  const cookie = event.req.headers.get('cookie');
  if (cookie) {
    headers.set('Cookie', cookie);
  }

  return completeBrowserAuth(await postAuth(event, '/api/auth/sign-out', headers));
}
