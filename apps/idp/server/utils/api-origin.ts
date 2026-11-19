import { useRuntimeConfig } from 'nuxt/server';
import * as valibot from 'valibot';

const apiUrlSchema = valibot.pipe(
  valibot.string(),
  valibot.url(),
  valibot.transform((url) => new URL(url)),
  valibot.check((url) => url.protocol === 'http:' || url.protocol === 'https:'),
);

export function apiOrigin(): string {
  return valibot.parse(apiUrlSchema, useRuntimeConfig().apiUrl).origin;
}
