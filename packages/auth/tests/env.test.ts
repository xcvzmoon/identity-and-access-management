import { useDatabase } from '@iam/database';
import { expect, test, vi } from 'vite-plus/test';
import { useAuth } from '../src/index.ts';
import { useAuthEnv } from '../src/utils/env.ts';

const source = {
  APP_ENV: 'testing',
  AUTH_SECRET: 'test-only-secret-with-at-least-32-characters',
  AUTH_URL: 'http://localhost:5173',
  AUTH_WEB_ORIGIN: 'http://localhost:5173',
};

test('validates auth configuration', () => {
  expect(useAuthEnv({ source })).toEqual({
    secret: source.AUTH_SECRET,
    url: source.AUTH_URL,
    webOrigin: source.AUTH_WEB_ORIGIN,
    idpOrigin: source.AUTH_WEB_ORIGIN,
    smtpUrl: '',
    smtpFrom: '',
  });
});

test.each(['https://iam.example.test', 'http://localhost:5173'])(
  'accepts matching production origins at %s',
  (origin) => {
    expect(
      useAuthEnv({
        source: {
          ...source,
          APP_ENV: 'production',
          AUTH_URL: origin,
          AUTH_WEB_ORIGIN: origin,
        },
      }),
    ).toMatchObject({
      url: origin,
      webOrigin: origin,
    });
  },
);

test('rejects a web origin that differs from the issuer', () => {
  expect(() =>
    useAuthEnv({
      source: {
        ...source,
        APP_ENV: 'production',
        AUTH_URL: 'https://iam.example.test',
        AUTH_WEB_ORIGIN: 'https://legacy.example.test',
      },
    }),
  ).toThrow('AUTH_WEB_ORIGIN must match AUTH_URL.');
});

test('accepts a dedicated IDP origin while keeping the issuer at the web origin', () => {
  expect(
    useAuthEnv({
      source: {
        ...source,
        AUTH_IDP_ORIGIN: 'http://localhost:5176',
      },
    }),
  ).toMatchObject({
    url: source.AUTH_URL,
    webOrigin: source.AUTH_WEB_ORIGIN,
    idpOrigin: 'http://localhost:5176',
  });
});

test.each(['AUTH_URL', 'AUTH_WEB_ORIGIN', 'AUTH_IDP_ORIGIN'])(
  'requires HTTPS for a public %s in production',
  (field) => {
    expect(() =>
      useAuthEnv({
        source: {
          ...source,
          APP_ENV: 'production',
          [field]: 'http://iam.example.test',
        },
      }),
    ).toThrow('AUTH_URL, AUTH_WEB_ORIGIN, and AUTH_IDP_ORIGIN must use HTTPS outside loopback.');
  },
);

test('requires SMTP relay and sender settings together', () => {
  expect(() =>
    useAuthEnv({
      source: {
        ...source,
        AUTH_SMTP_URL: 'smtps://smtp.example.test',
      },
    }),
  ).toThrow('Configure AUTH_SMTP_URL and AUTH_SMTP_FROM together.');
});

test('rejects relay URLs with transport overrides', () => {
  expect(() =>
    useAuthEnv({
      source: {
        ...source,
        AUTH_SMTP_URL: 'smtp://smtp.example.test?ignoreTLS=true',
        AUTH_SMTP_FROM: 'iam@example.test',
      },
    }),
  ).toThrow();
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
