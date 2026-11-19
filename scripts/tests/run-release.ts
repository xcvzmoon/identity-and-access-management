import { consola } from 'consola';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import manifest from '../../package.json' with { type: 'json' };
import { captureReleaseInputs } from './release-inputs.ts';
import { releasePhases, verifyReleaseReport } from './release-report.ts';

const CLI_ARGUMENT_OFFSET = 2;
const EMPTY = 0;

const root = path.resolve(import.meta.dirname, '../..');
const testsDirectory = path.join(root, 'apps/idp/api/tests');

function runAuditChecks(fixtures: string): void {
  const auditSettings = parseEnv(readFileSync(path.join(fixtures, 'phase-8.env'), 'utf8'));
  if (auditSettings.PGDATABASE !== 'iam_phase8_test') {
    throw new Error('phase-8.env must set PGDATABASE to iam_phase8_test.');
  }

  execFileSync(
    'psql',
    [
      '-X',
      '--no-password',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      path.join(testsDirectory, 'audit-access.sql'),
    ],
    {
      cwd: root,
      env: { ...process.env, ...auditSettings },
      stdio: 'inherit',
    },
  );
}

function runReleaseTests(): void {
  const [fixtures, evidence, ...extra] = process.argv.slice(CLI_ARGUMENT_OFFSET);
  if (!fixtures || !evidence || extra.length > EMPTY) {
    throw new Error('Usage: test:release <fixture-env-directory> <new-evidence-directory>');
  }

  const directory = path.resolve(evidence);
  assert.equal(
    process.versions.node,
    manifest.engines.node,
    'Release runner must use the pinned Node version. Run vp install --frozen-lockfile.',
  );
  const inputs = captureReleaseInputs(root);
  const startedAt = new Date().toISOString();

  mkdirSync(directory, { mode: 0o700 });
  for (const phase of releasePhases) {
    const { name } = phase;
    const fixture = name.replace('-', '');
    const settings = parseEnv(readFileSync(path.join(fixtures, `${name}.env`), 'utf8'));
    const database = `iam_${fixture}_test`;
    if (settings.DB_DATABASE !== database) {
      throw new Error(`${name}.env must set DB_DATABASE to ${database}.`);
    }

    const output = path.join(directory, `${name}.json`);
    const files = phase.suites.map((suite) => path.join(testsDirectory, suite.file));
    const reporter = ['--reporter=json', '--outputFile', output];
    const verifyIngress = name === 'phase-6';
    const program = verifyIngress ? 'sh' : 'vp';
    const args = verifyIngress
      ? ['scripts/tests/verify-ingress-logs.sh', ...reporter]
      : ['test', '--run', ...reporter, ...files];

    execFileSync(program, args, {
      cwd: root,
      env: {
        ...process.env,
        ...settings,
        ...(name === 'phase-5' && {
          IAM_PHASE5_INTROSPECTION_REPORT: path.join(directory, 'introspection-capacity.json'),
        }),
        ...(verifyIngress && {
          IAM_PHASE6_LOGIN_REPORT: path.join(directory, 'console-login-capacity.json'),
        }),
        [`IAM_${fixture.toUpperCase()}_TESTS`]: '1',
      },
      stdio: 'inherit',
    });
    verifyReleaseReport(readFileSync(output, 'utf8'), phase.suites, testsDirectory);
    assert.deepEqual(captureReleaseInputs(root), inputs, `Release inputs changed during ${name}.`);
  }

  runAuditChecks(fixtures);
  assert.deepEqual(
    captureReleaseInputs(root),
    inputs,
    'Release inputs changed during audit checks.',
  );

  const receipt = {
    auditAccess: 'passed',
    ingressLogs: 'passed',
    ...inputs,
    nodeVersion: process.version,
    startedAt,
    finishedAt: new Date().toISOString(),
    phases: releasePhases.map((phase) => phase.name.replace('phase-', '')),
    passedCases: releasePhases.flatMap((phase) => phase.suites.flatMap((suite) => suite.titles))
      .length,
  };
  writeFileSync(path.join(directory, 'passed.json'), `${JSON.stringify(receipt)}\n`, {
    flag: 'wx',
  });
  consola.success(`All required integration tests passed. Evidence is in ${directory}.`);
}

try {
  runReleaseTests();
} catch (error) {
  consola.error(error instanceof Error ? error.message : 'Release tests failed.');
  process.exitCode = 1;
}
