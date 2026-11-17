import { useEnv } from '@iam/shared/utils';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';

type AuthEnvOptions = Pick<Parameters<typeof useEnv>[number], 'source'>;

const minimumSecretLength = 32;
const originSchema = valibot.pipe(
  valibot.string(),
  valibot.url(),
  valibot.check((value) => {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  }, 'Expected an HTTP origin without a path or trailing slash.'),
);

export function useAuthEnv(options: AuthEnvOptions = {}): {
  secret: string;
  url: string;
  webOrigin: string;
} {
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
      },
    },
  });

  return env.auth;
}
