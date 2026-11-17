import { PostgresJsSession } from 'drizzle-orm/postgres-js';
import { EnhancedQueryLogger } from 'drizzle-query-logger';
import { expect, test } from 'vite-plus/test';
import { createDatabase, useDatabaseEnv } from '../src/index.ts';

const source = {
  APP_ENV: 'testing',
  DB_HOST: 'localhost',
  DB_USER: 'iam',
  DB_PASSWORD: 'test-password',
  DB_DATABASE: 'iam',
};
const defaultPort = 5432;

test('loads explicit connection fields and defaults SSL and logger to false', () => {
  expect(useDatabaseEnv({ source })).toEqual({
    host: 'localhost',
    port: defaultPort,
    user: 'iam',
    password: 'test-password',
    database: 'iam',
    ssl: false,
    logger: false,
  });
});

test('defaults the port when absent and parses explicit boolean flags', () => {
  expect(
    useDatabaseEnv({
      source: {
        ...source,
        DB_SSL: 'true',
        DB_LOGGER: 'true',
      },
    }),
  ).toMatchObject({
    port: defaultPort,
    ssl: true,
    logger: true,
  });
});

test.each(['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'])('requires %s', (field) => {
  expect(() =>
    useDatabaseEnv({
      source: {
        ...source,
        [field]: '',
      },
    }),
  ).toThrow();
});

test('rejects missing connection fields', () => {
  expect(() => useDatabaseEnv({ source: { APP_ENV: 'testing' } })).toThrow();
});

test.each(['0', '65536', '-1', '1.5', '', 'invalid', 'Infinity'])(
  'rejects invalid database port %s',
  (port) => {
    expect(() =>
      useDatabaseEnv({
        source: {
          ...source,
          DB_PORT: port,
        },
      }),
    ).toThrow();
  },
);

test.each(['DB_SSL', 'DB_LOGGER'])('rejects invalid boolean for %s', (field) => {
  expect(() =>
    useDatabaseEnv({
      source: {
        ...source,
        [field]: 'invalid',
      },
    }),
  ).toThrow();
});

test('supports explicit local sources and preserves the shared workspace requirement', () => {
  const localSource = {
    ...source,
    APP_ENV: 'local',
  };
  expect(() => useDatabaseEnv({ source: localSource })).toThrow(
    'workspacePath is required when APP_ENV is local',
  );
  expect(
    useDatabaseEnv({
      source: localSource,
      workspacePath: 'packages/database',
    }).host,
  ).toBe('localhost');
});

test.each([false, true])('creates a lazy pool with logger enabled=%s', async (logger) => {
  const config = useDatabaseEnv({ source });
  const database = createDatabase({ ...config, logger });
  try {
    expect(database.$client.options.host).toEqual([config.host]);
    expect(database.$client.options.port).toEqual([config.port]);
    expect(database.$client.options.user).toBe(config.user);
    expect(database.$client.options.database).toBe(config.database);
    expect(database.$client.options.ssl).toBe(config.ssl);
    expect(database.query).toEqual({});
    const { session } = database._;
    expect(session instanceof PostgresJsSession).toBe(true);
    expect(
      session instanceof PostgresJsSession && session.logger instanceof EnhancedQueryLogger,
    ).toBe(logger);
  } finally {
    await database.$client.end();
  }
});
