import { consola } from 'consola';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { releasePhases, verifyReleaseReport } from './release-report.ts';

const CLI_ARGUMENT_OFFSET = 2;
const EMPTY = 0;

const root = path.resolve(import.meta.dirname, '../..');
const testsDirectory = path.join(root, 'apps/idp/api/tests');

function runReleaseTests(): void {
  const [fixtures, evidence, ...extra] = process.argv.slice(CLI_ARGUMENT_OFFSET);
  if (!fixtures || !evidence || extra.length > EMPTY) {
    throw new Error('Usage: test:release <fixture-env-directory> <new-evidence-directory>');
  }

  const directory = path.resolve(evidence);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root }).length > EMPTY;
  const startedAt = new Date().toISOString();

  mkdirSync(directory, { mode: 0o700 });
  for (const phase of releasePhases) {
    const name = `phase-${phase.number}`;
    const settings = parseEnv(readFileSync(path.join(fixtures, `${name}.env`), 'utf8'));
    const database = `iam_phase${phase.number}_test`;
    if (settings.DB_DATABASE !== database) {
      throw new Error(`${name}.env must set DB_DATABASE to ${database}.`);
    }

    const output = path.join(directory, `${name}.json`);
    const files = phase.suites.map((suite) => path.join(testsDirectory, suite.file));
    const reporter = ['--reporter=json', '--outputFile', output];
    const verifyIngress = phase.number === '6';
    const program = verifyIngress ? 'sh' : 'vp';
    const args = verifyIngress
      ? ['scripts/tests/verify-ingress-logs.sh', ...reporter]
      : ['test', '--run', ...reporter, ...files];

    execFileSync(program, args, {
      cwd: root,
      env: {
        ...process.env,
        ...settings,
        [`IAM_PHASE${phase.number}_TESTS`]: '1',
      },
      stdio: 'inherit',
    });
    verifyReleaseReport(readFileSync(output, 'utf8'), phase.suites, testsDirectory);
  }

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

  const receipt = {
    auditAccess: 'passed',
    ingressLogs: 'passed',
    revision,
    dirty,
    startedAt,
    finishedAt: new Date().toISOString(),
    phases: releasePhases.map((phase) => phase.number),
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
