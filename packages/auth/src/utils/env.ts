import { useEnv } from '@iam/shared/utils';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';

type AuthEnvOptions = Pick<Parameters<typeof useEnv>[number], 'source'>;

const minimumSecretLength = 32;
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const smtpUrlSchema = valibot.union(
  [
    valibot.literal(''),
    valibot.pipe(
      valibot.string(),
      valibot.url('Expected a valid SMTP relay URL.'),
      valibot.check((value) => {
        const relay = new URL(value);
        return (
          (relay.protocol === 'smtp:' || relay.protocol === 'smtps:') &&
          Boolean(relay.hostname) &&
          (relay.pathname === '' || relay.pathname === '/') &&
          !relay.search &&
          !relay.hash &&
          Boolean(relay.username) === Boolean(relay.password)
        );
      }, 'Expected an SMTP relay URL without a path, query, or fragment.'),
    ),
  ],
  'Expected an SMTP relay URL without a path, query, or fragment.',
);
const smtpFromSchema = valibot.union([
  valibot.literal(''),
  valibot.pipe(valibot.string(), valibot.email()),
]);
const originSchema = valibot.pipe(
  valibot.string(),
  valibot.url(),
  valibot.check((value) => {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  }, 'Expected an HTTP origin without a path or trailing slash.'),
);

function isSecureOrLoopbackOrigin(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === 'https:' || loopbackHosts.has(url.hostname);
}

type AuthEnv = {
  secret: string;
  url: string;
  webOrigin: string;
  idpOrigin: string;
  smtpUrl: string;
  smtpFrom: string;
};

export function useAuthEnv(options: AuthEnvOptions = {}): AuthEnv {
  const workspacePath =
    !process.env.APP_ENV || process.env.APP_ENV === 'local'
      ? path.dirname(fileURLToPath(import.meta.resolve('@iam/auth/package.json')))
      : '';

  const env = useEnv({
    ...options,
    workspacePath,
    schema: {
      auth: {
        secret: valibot.pipe(valibot.string(), valibot.minLength(minimumSecretLength)),
        url: originSchema,
        webOrigin: originSchema,
        idpOrigin: valibot.optional(originSchema),
        smtpUrl: valibot.optional(smtpUrlSchema, ''),
        smtpFrom: valibot.optional(smtpFromSchema, ''),
      },
    },
  });

  const idpOrigin = env.auth.idpOrigin ?? env.auth.webOrigin;
  const appEnvironment = (options.source ?? process.env).APP_ENV;
  if (
    appEnvironment !== 'local' &&
    appEnvironment !== 'testing' &&
    ![env.auth.url, env.auth.webOrigin, idpOrigin].every((origin) =>
      isSecureOrLoopbackOrigin(origin),
    )
  ) {
    throw new Error(
      'AUTH_URL, AUTH_WEB_ORIGIN, and AUTH_IDP_ORIGIN must use HTTPS outside loopback.',
    );
  }

  if (env.auth.url !== env.auth.webOrigin) {
    throw new Error('AUTH_WEB_ORIGIN must match AUTH_URL.');
  }

  if (Boolean(env.auth.smtpUrl) !== Boolean(env.auth.smtpFrom)) {
    throw new Error('Configure AUTH_SMTP_URL and AUTH_SMTP_FROM together.');
  }

  return { ...env.auth, idpOrigin };
}
