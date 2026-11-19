import assert from 'node:assert/strict';
import path from 'node:path';
import { array, literal, object, parse, string } from 'valibot';

type ReleaseSuite = {
  file: string;
  titles: readonly string[];
};

type ReleasePhase = {
  name: string;
  suites: readonly ReleaseSuite[];
};

const assertionSchema = object({
  title: string(),
  status: literal('passed'),
});
const suiteSchema = object({
  name: string(),
  status: literal('passed'),
  assertionResults: array(assertionSchema),
});
const reportSchema = object({ testResults: array(suiteSchema) });

export const releasePhases: readonly ReleasePhase[] = [
  {
    name: 'phase-3',
    suites: [
      {
        file: 'invitations.test.ts',
        titles: [
          'rejects direct signup and ineligible invitations before creating an account',
          'requires a verified invitee and commits exactly one membership on concurrent acceptance',
          'reset consumes the email token, replaces the password and revokes both sessions',
        ],
      },
    ],
  },
  {
    name: 'phase-4',
    suites: [
      {
        file: 'oidc.test.ts',
        titles: ['Phase 4 issuer and reference app'],
      },
    ],
  },
  {
    name: 'phase-5',
    suites: [
      {
        file: 'live-access.test.ts',
        titles: ['enforces live grants and IAM sign-out across IdP replicas'],
      },
    ],
  },
  {
    name: 'phase-6',
    suites: [
      {
        file: 'console-session.test.ts',
        titles: ['opens an independent console session for a verified account'],
      },
    ],
  },
  {
    name: 'phase-7',
    suites: [
      {
        file: 'administration.test.ts',
        titles: ['onboards and recovers an owner and enforces console administration boundaries'],
      },
      {
        file: 'passkey-session.test.ts',
        titles: ['rejects a passkey challenge transferred between two sessions of the same user'],
      },
    ],
  },
  {
    name: 'phase-9',
    suites: [
      {
        file: 'signing-key-rotation.test.ts',
        titles: [
          'concurrent rotation publishes and activates once, then restores the trusted signer',
        ],
      },
    ],
  },
  {
    name: 'rotation',
    suites: [
      {
        file: 'client-secret-rotation.test.ts',
        titles: ['rotates managed client secrets at immediate cutoff'],
      },
    ],
  },
];

/**
 * Checks the JSON report written by the installed Vitest reporter for one release phase.
 * @param {string} json - Raw Vitest JSON report for the phase.
 * @param {readonly ReleaseSuite[]} suites - Test files and case titles required for this phase.
 * @param {string} testsDirectory - Absolute directory containing the integration test files.
 * @throws {Error} When the report is malformed or a required result is missing or unsuccessful.
 */
export function verifyReleaseReport(
  json: string,
  suites: readonly ReleaseSuite[],
  testsDirectory: string,
): void {
  const report: unknown = JSON.parse(json);
  const expectedTotal = suites.flatMap((suite) => suite.titles).length;
  assert.partialDeepStrictEqual(
    report,
    {
      success: true,
      numTotalTests: expectedTotal,
      numPassedTests: expectedTotal,
      numFailedTestSuites: 0,
      numPendingTestSuites: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    },
    'Vitest did not report every expected test as passed.',
  );

  const { testResults } = parse(reportSchema, report);
  assert.equal(testResults.length, suites.length, 'Unexpected number of suite results.');
  for (const suite of suites) {
    const filename = path.join(testsDirectory, suite.file);
    const result = testResults.find((entry) => entry.name === filename);
    assert.ok(result, `Missing suite: ${filename}`);
    assert.deepEqual(
      result.assertionResults.map((assertion) => assertion.title).toSorted(),
      suite.titles.toSorted(),
      `Unexpected cases in ${suite.file}.`,
    );
  }
}
