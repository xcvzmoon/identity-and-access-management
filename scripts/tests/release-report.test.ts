import path from 'node:path';
import { expect, test } from 'vite-plus/test';
import { releasePhases, verifyReleaseReport } from './release-report.ts';

const testsDirectory = path.join(import.meta.dirname, 'fixtures');
const suites = [
  {
    file: 'acceptance.test.ts',
    titles: ['starts a session', 'ends a session'],
  },
];
const assertions = suites.flatMap((suite) =>
  suite.titles.map((title) => ({
    title,
    status: 'passed',
  })),
);
const suiteResult = {
  name: path.join(testsDirectory, 'acceptance.test.ts'),
  status: 'passed',
  assertionResults: assertions,
};
const passing = {
  success: true,
  numTotalTests: assertions.length,
  numPassedTests: assertions.length,
  numFailedTestSuites: 0,
  numPendingTestSuites: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [suiteResult],
};

test('accepts required cases in any reporter order', () => {
  const report = structuredClone(passing);
  for (const suite of report.testResults) {
    suite.assertionResults.reverse();
  }

  expect(() => {
    verifyReleaseReport(JSON.stringify(report), suites, testsDirectory);
  }).not.toThrow();
});

test('rejects an extra suite omitted from the summary counts', () => {
  const report = structuredClone(passing);
  report.testResults.push(suiteResult);

  expect(() => {
    verifyReleaseReport(JSON.stringify(report), suites, testsDirectory);
  }).toThrow();
});

test('rejects an extra assertion omitted from the summary counts', () => {
  const report = structuredClone(passing);
  const [suite] = report.testResults;
  suite.assertionResults.push({
    title: 'unexpected case',
    status: 'failed',
  });

  expect(() => {
    verifyReleaseReport(JSON.stringify(report), suites, testsDirectory);
  }).toThrow();
});

test('rejects duplicate titles even when the number of passed cases matches', () => {
  const report = structuredClone(passing);
  const [suite] = report.testResults;
  const [first, second] = suite.assertionResults;

  second.title = first.title;

  expect(() => {
    verifyReleaseReport(JSON.stringify(report), suites, testsDirectory);
  }).toThrow();
});

test.each(['skipped', 'todo', 'failed'])('rejects a required case reported as %s', (status) => {
  const report = structuredClone(passing);
  const [suite] = report.testResults;
  const [first] = suite.assertionResults;

  first.status = status;

  expect(() => {
    verifyReleaseReport(JSON.stringify(report), suites, testsDirectory);
  }).toThrow();
});

test('rejects a missing file even if another file has the same case titles', () => {
  const report = structuredClone(passing);
  const [suite] = report.testResults;

  suite.name = path.join(testsDirectory, 'elsewhere.test.ts');

  expect(() => {
    verifyReleaseReport(JSON.stringify(report), suites, testsDirectory);
  }).toThrow();
});

test('rejects a suite failure after passing assertions', () => {
  const report = structuredClone(passing);
  const [suite] = report.testResults;

  suite.status = 'failed';

  expect(() => {
    verifyReleaseReport(JSON.stringify(report), suites, testsDirectory);
  }).toThrow();
});

test('requires the independent client secret cutoff fixture for promotion', () => {
  const rotation = releasePhases.find((phase) => phase.name === 'rotation');
  expect(rotation?.suites).toEqual([
    {
      file: 'client-secret-rotation.test.ts',
      titles: ['rotates managed client secrets at immediate cutoff'],
    },
  ]);
});
