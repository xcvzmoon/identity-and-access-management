import { useDatabase } from '@iam/database';
import { expect, test, vi } from 'vite-plus/test';
import { useAuth } from '../src/index.ts';
import { useAuthEnv } from '../src/utils/env.ts';

const source = {
  APP_ENV: 'testing',
  AUTH_SECRET: 'test-only-secret-with-at-least-32-characters',
  AUTH_URL: 'http://localhost:3000',
  AUTH_WEB_ORIGIN: 'http://localhost:5173',
};

test('validates auth configuration', () => {
  expect(useAuthEnv({ source })).toEqual({
    secret: source.AUTH_SECRET,
    url: source.AUTH_URL,
    webOrigin: source.AUTH_WEB_ORIGIN,
  });
});

test.each(['AUTH_SECRET', 'AUTH_URL', 'AUTH_WEB_ORIGIN'])('requires %s', (field) => {
  expect(() =>
    useAuthEnv({
      source: {
        ...source,
        [field]: '',
      },
    }),
  ).toThrow();
});

test.each(['https://example.com/', 'https://example.com/path', 'ftp://example.com', 'invalid'])(
  'rejects a non-origin auth URL: %s',
  (url) => {
    expect(() =>
      useAuthEnv({
        source: {
          ...source,
          AUTH_URL: url,
        },
      }),
    ).toThrow();
  },
);

test('initializes and reuses the auth server', async () => {
  const environment = {
    ...source,
    DB_HOST: 'localhost',
    DB_USER: 'iam',
    DB_PASSWORD: 'test-only',
    DB_DATABASE: 'iam',
  };
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
  try {
    expect(useAuth()).toBe(useAuth());
  } finally {
    await useDatabase().$client.end();
    vi.unstubAllEnvs();
  }
});
