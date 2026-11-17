import { EnvValidationError, integerEnv } from '@xcvzlabs/env';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { useEnv } from '../src/utils/env.ts';

const filePort = 4321;
const processPort = 8765;
const sourcePort = 1234;
const schema = { iamTestPort: integerEnv };
const deploymentEnvironments: ('testing' | 'staging' | 'production')[] = [
  'testing',
  'staging',
  'production',
];
let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'iam-env-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.stubEnv('APP_ENV', 'local');
  vi.stubEnv('IAM_TEST_PORT', process.env.IAM_TEST_PORT);
  delete process.env.IAM_TEST_PORT;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, {
    recursive: true,
    force: true,
  });
});

test('local mode reads only the explicit workspace file and preserves inferred types', () => {
  const workspace = path.join(directory, 'apps/api');
  const sibling = path.join(directory, 'apps/web');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(path.join(directory, '.env'), 'IAM_TEST_PORT=9999\n');
  writeFileSync(path.join(sibling, '.env'), 'IAM_TEST_PORT=9999\n');
  writeFileSync(path.join(workspace, '.env'), `IAM_TEST_PORT="${filePort}"\n`);

  const env = useEnv({
    workspacePath: 'apps/api',
    schema,
  });

  expect(env.iamTestPort).toBe(filePort);
  expectTypeOf(env.iamTestPort).toEqualTypeOf<number>();
  expect(process.env.IAM_TEST_PORT).toBeUndefined();
  expect(
    useEnv({
      workspacePath: workspace,
      schema,
    }),
  ).toEqual(env);
});

test('local mode gives process variables precedence over file values', () => {
  writeFileSync(path.join(directory, '.env'), `APP_ENV=production\nIAM_TEST_PORT=${filePort}\n`);
  vi.stubEnv('IAM_TEST_PORT', String(processPort));

  expect(
    useEnv({
      workspacePath: directory,
      schema,
    }).iamTestPort,
  ).toBe(processPort);
});

test('a missing local file uses process variables without falling back to a parent file', () => {
  const workspace = path.join(directory, 'apps/api');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(directory, '.env'), `IAM_TEST_PORT=${filePort}\n`);

  expect(() =>
    useEnv({
      workspacePath: workspace,
      schema,
    }),
  ).toThrow(EnvValidationError);
  vi.stubEnv('IAM_TEST_PORT', String(processPort));
  expect(
    useEnv({
      workspacePath: workspace,
      schema,
    }).iamTestPort,
  ).toBe(processPort);
});

test.each(deploymentEnvironments)(
  '%s reads process variables without loading an env file',
  (environment) => {
    vi.stubEnv('APP_ENV', environment);
    writeFileSync(path.join(directory, '.env'), `IAM_TEST_PORT=${filePort}\n`);

    expect(() => useEnv({ schema })).toThrow(EnvValidationError);
    vi.stubEnv('IAM_TEST_PORT', String(processPort));
    expect(useEnv({ schema }).iamTestPort).toBe(processPort);

    rmSync(path.join(directory, '.env'));
    mkdirSync(path.join(directory, '.env'));
    expect(
      useEnv({
        schema,
        workspacePath: directory,
      }).iamTestPort,
    ).toBe(processPort);
  },
);

test('an explicit local source bypasses file loading and process variables', () => {
  mkdirSync(path.join(directory, '.env'));
  vi.stubEnv('IAM_TEST_PORT', String(processPort));

  const env = useEnv({
    workspacePath: directory,
    schema,
    source: {
      APP_ENV: 'local',
      IAM_TEST_PORT: String(sourcePort),
    },
  });

  expect(env.iamTestPort).toBe(sourcePort);
});

test.each(deploymentEnvironments)(
  '%s uses an explicit source without merging process variables',
  (environment) => {
    vi.stubEnv('APP_ENV', environment);
    vi.stubEnv('IAM_TEST_PORT', String(processPort));

    expect(() =>
      useEnv({
        schema,
        source: { APP_ENV: environment },
      }),
    ).toThrow(EnvValidationError);
    expect(
      useEnv({
        schema,
        source: {
          APP_ENV: environment,
          IAM_TEST_PORT: String(sourcePort),
        },
      }).iamTestPort,
    ).toBe(sourcePort);
  },
);

test('local file errors other than a missing file propagate', () => {
  mkdirSync(path.join(directory, '.env'));

  expect(() =>
    useEnv({
      workspacePath: directory,
      schema,
    }),
  ).toThrow();
});

test.each(['', 'development', 'preview'])(
  'rejects invalid APP_ENV %j before reading files',
  (value) => {
    vi.stubEnv('APP_ENV', value);
    mkdirSync(path.join(directory, '.env'));

    expect(() =>
      useEnv({
        schema,
        workspacePath: directory,
      }),
    ).toThrow('Expected APP_ENV to be local, testing, staging, or production.');
  },
);

test('reads APP_ENV from the workspace file without inferring a mode from NODE_ENV', () => {
  delete process.env.APP_ENV;
  vi.stubEnv('NODE_ENV', 'production');
  writeFileSync(path.join(directory, '.env'), `APP_ENV=local\nIAM_TEST_PORT=${filePort}\n`);

  expect(
    useEnv({
      schema,
      workspacePath: directory,
    }).iamTestPort,
  ).toBe(filePort);
  expect(process.env.APP_ENV).toBeUndefined();
  expect(process.env.IAM_TEST_PORT).toBeUndefined();
});

test('requires a workspace path when APP_ENV is local', () => {
  expect(() => useEnv({ schema })).toThrow('workspacePath is required when APP_ENV is local');
});

test('an explicit source selects the environment independently of process variables', () => {
  vi.stubEnv('APP_ENV', 'invalid');
  mkdirSync(path.join(directory, '.env'));

  expect(
    useEnv({
      workspacePath: directory,
      schema,
      source: {
        APP_ENV: 'testing',
        IAM_TEST_PORT: String(sourcePort),
      },
    }).iamTestPort,
  ).toBe(sourcePort);
});

test('an explicit source must provide APP_ENV without falling back to process variables', () => {
  vi.stubEnv('APP_ENV', 'production');

  expect(() =>
    useEnv({
      schema,
      source: { IAM_TEST_PORT: String(sourcePort) },
    }),
  ).toThrow('Expected APP_ENV to be local, testing, staging, or production.');
});

test('does not search parent files when APP_ENV is absent from the explicit workspace', () => {
  delete process.env.APP_ENV;
  const workspace = path.join(directory, 'apps/api');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(directory, '.env'), `APP_ENV=local\nIAM_TEST_PORT=${filePort}\n`);

  expect(() =>
    useEnv({
      schema,
      workspacePath: workspace,
    }),
  ).toThrow('Expected APP_ENV to be local, testing, staging, or production.');
});

test.each(['', 'preview'])('rejects invalid APP_ENV %j in a workspace file', (value) => {
  delete process.env.APP_ENV;
  writeFileSync(path.join(directory, '.env'), `APP_ENV=${value}\n`);

  expect(() =>
    useEnv({
      schema,
      workspacePath: directory,
    }),
  ).toThrow('Expected APP_ENV to be local, testing, staging, or production.');
});

test.each(deploymentEnvironments)(
  '%s discovered from a file still uses only process variables for configuration',
  (environment) => {
    delete process.env.APP_ENV;
    writeFileSync(
      path.join(directory, '.env'),
      `APP_ENV=${environment}\nIAM_TEST_PORT=${filePort}\n`,
    );

    expect(() =>
      useEnv({
        schema,
        workspacePath: directory,
      }),
    ).toThrow(EnvValidationError);
    vi.stubEnv('IAM_TEST_PORT', String(processPort));
    expect(
      useEnv({
        schema,
        workspacePath: directory,
      }).iamTestPort,
    ).toBe(processPort);
  },
);

test('a supplied source never falls back to APP_ENV in the workspace file', () => {
  delete process.env.APP_ENV;
  writeFileSync(path.join(directory, '.env'), 'APP_ENV=local\n');

  expect(() =>
    useEnv({
      schema,
      workspacePath: directory,
      source: {},
    }),
  ).toThrow('Expected APP_ENV to be local, testing, staging, or production.');
});
