import type { APIResponse, Page } from 'playwright';
import { and, desc, eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:http2';
import { chromium } from 'playwright';
import * as valibot from 'valibot';
import { expect, test, vi } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { oauthClientEvents, oauthClients, ownerRecoveryEvents } from '../server/database/schema.ts';
import { provisionClient } from '../server/services/registration.service.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';
import { openAuditReader } from './fixtures/audit-reader.ts';
import { registerAndAssign } from './fixtures/console-administration.ts';
import { startCluster } from './fixtures/live-processes.ts';
import { checkManagementIsolation } from './fixtures/management-isolation.ts';
import { seedAccount } from './fixtures/oidc.ts';
import { recordOrganizationCapacity } from './fixtures/organization-capacity.ts';

type Recovery = { operatorId: string; organizationId: string; replacement: Account };

type Account = Awaited<ReturnType<typeof seedAccount>>;

const TIMEOUT = 120_000;
const LATEST_EVENT_COUNT = 1;
const OWNER_PATH = '/api/v1/operator/owner-invitations';
const MANAGEMENT_PATH = '/api/v1/management';
const enabled = process.env.IAM_PHASE7_TESTS === '1';
const organizationSchema = valibot.object({ organizationId: valibot.string() });
async function post(
  page: Page,
  origin: string,
  path: string,
  data: Record<string, string | boolean | string[]>,
): Promise<APIResponse> {
  const headers = { origin };
  return page.request.post(new URL(path, origin).href, { headers, data });
}

async function signIn(page: Page, issuer: string, account: Account): Promise<void> {
  const response = await post(page, issuer, '/api/v1/auth/sign-in/email', {
    email: account.email,
    password: account.password,
  });
  expect(response.status()).toBe(constants.HTTP_STATUS_OK);
}

async function enrollPasskey(page: Page, issuer: string): Promise<() => Promise<void>> {
  const protocol = await page.context().newCDPSession(page);
  await protocol.send('WebAuthn.enable');
  const { authenticatorId } = await protocol.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(new URL('/passkeys', issuer).href);
  await page.getByRole('button', { name: 'Enroll a passkey' }).click();
  await page.getByText('Passkey enrolled. Verify it to continue.').waitFor();
  await page.getByRole('button', { name: 'Verify passkey' }).click();
  await page.getByText('Passkey verified. Return to your console to continue.').waitFor();
  return async () => {
    await protocol.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  };
}

async function acceptOwner(page: Page, issuer: string, email: string): Promise<void> {
  const mailbox = new URL('/view/latest.txt', process.env.IAM_PHASE7_MAILPIT);
  assert.equal(mailbox.hostname, '127.0.0.1');
  mailbox.searchParams.set('query', `to:"${email}" subject:"Accept organization ownership"`);
  await expect
    .poll(
      async () => {
        const delivery = await fetch(mailbox);
        const body = await delivery.text();
        return body.includes(issuer);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const response = await fetch(mailbox);
  const message = await response.text();
  const link = message.split(/\s+/u).find((word) => word.startsWith(issuer));
  assert.ok(link);
  const token = new URLSearchParams(new URL(link).hash.replace(/^#/u, '')).get('token');
  assert.ok(token);
  const accepted = await post(page, issuer, '/api/v1/invitations/accept', { token });
  expect(accepted.status()).toBe(constants.HTTP_STATUS_OK);
}

async function onboard(
  operatorPage: Page,
  issuer: string,
  operator: Account,
  ownerEmail: string,
): Promise<string> {
  const bootstrap = {
    operation: 'bootstrap',
    name: 'Fixture organization',
    slug: randomUUID(),
    ownerEmail,
  };
  await signIn(operatorPage, issuer, operator);
  const denied = await post(operatorPage, issuer, OWNER_PATH, bootstrap);
  expect(denied.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);
  await enrollPasskey(operatorPage, issuer);
  await operatorPage.goto(new URL('/operator', issuer).href);
  await operatorPage.getByLabel('Organization name').fill(bootstrap.name);
  await operatorPage.getByLabel('Organization slug').fill(bootstrap.slug);
  await operatorPage.getByLabel('Owner email address').fill(ownerEmail);
  const submitted = operatorPage.waitForResponse(new URL(OWNER_PATH, issuer).href);
  await operatorPage.getByRole('button', { name: 'Send owner invitation' }).click();
  const created = await submitted;
  expect(created.status()).toBe(constants.HTTP_STATUS_OK);
  const { organizationId } = valibot.parse(organizationSchema, await created.json());

  return organizationId;
}

async function administer(
  ownerPage: Page,
  consoleOrigin: string,
  owner: Account,
  organizationId: string,
): Promise<void> {
  const env = useEnv();
  const issuer = env.oidcIssuerUrl;
  await signIn(ownerPage, issuer, owner);
  await acceptOwner(ownerPage, issuer, owner.email);
  await ownerPage.goto(new URL('/api/v1/login?returnTo=/management', consoleOrigin).href);
  await ownerPage.getByRole('heading', { name: 'Fixture organization' }).waitFor();

  const app = {
    action: 'register',
    organizationId,
    name: 'Reports',
    redirectUri: 'https://reports.localhost/callback',
  };
  const unverified = await post(ownerPage, consoleOrigin, MANAGEMENT_PATH, app);
  expect(unverified.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);
  const loseOwnerKey = await enrollPasskey(ownerPage, issuer);
  const denied = await post(ownerPage, issuer, OWNER_PATH, {});
  expect(denied.status()).toBe(constants.HTTP_STATUS_FORBIDDEN);
  await registerAndAssign(ownerPage, consoleOrigin, owner.email);
  const report = process.env.IAM_PHASE7_ORGANIZATION_REPORT;
  if (report) {
    await recordOrganizationCapacity(
      ownerPage,
      consoleOrigin,
      {
        organizationId,
        ownerId: owner.userId,
      },
      report,
    );
  }
  await checkManagementIsolation(ownerPage, consoleOrigin, owner.userId, organizationId);

  await loseOwnerKey();
}

async function recover(
  operatorPage: Page,
  replacementPage: Page,
  issuer: string,
  { operatorId, replacement, organizationId }: Recovery,
): Promise<void> {
  const reader = openAuditReader();
  const caseReference = randomUUID();
  const recovery = {
    operation: 'recover',
    organizationId,
    ownerEmail: replacement.email,
    caseReference,
    verifiedOwnerLockout: true,
  };
  await operatorPage.getByRole('button', { name: 'Open recovery' }).click();
  await operatorPage.getByLabel('Organization ID').fill(organizationId);
  await operatorPage.getByLabel('Verified case reference').fill(caseReference);
  await operatorPage.getByLabel('Owner email address').fill(replacement.email);
  await operatorPage.getByRole('checkbox').check();
  const submitted = operatorPage.waitForResponse(new URL(OWNER_PATH, issuer).href);
  await operatorPage.getByRole('button', { name: 'Send owner invitation' }).click();
  const recovered = await submitted;
  expect(recovered.status()).toBe(constants.HTTP_STATUS_OK);
  const duplicate = await post(operatorPage, issuer, OWNER_PATH, recovery);
  expect(duplicate.status()).toBe(constants.HTTP_STATUS_BAD_REQUEST);

  await signIn(replacementPage, issuer, replacement);
  await acceptOwner(replacementPage, issuer, replacement.email);
  await enrollPasskey(replacementPage, issuer);
  const audit = await reader
    .select()
    .from(ownerRecoveryEvents)
    .where(eq(ownerRecoveryEvents.caseReference, caseReference));
  const id: unknown = expect.any(String);
  const createdAt: unknown = expect.any(Date);

  expect(audit).toEqual([
    {
      id,
      organizationId,
      operatorId,
      caseReference,
      createdAt,
      outcome: 'invited',
    },
  ]);
}

test.skipIf(!enabled)(
  'onboards and recovers an owner and enforces console administration boundaries',
  async ({ onTestFinished }) => {
    initializeEnv();
    const env = useEnv();
    assert.equal(env.db.database, 'iam_phase7_test');

    const issuer = env.oidcIssuerUrl;
    const database = useDatabase();
    const operator = await seedAccount();
    const owner = await seedAccount();
    const replacement = await seedAccount();
    vi.stubEnv('OPERATOR_USER_IDS', operator.userId);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    const cluster = await startCluster(new URL(issuer));
    onTestFinished(cluster.close);
    const consoleOrigin = cluster.consoleOrigin;
    const registration = await provisionClient(operator.headers, {
      kind: 'console',
      name: 'IAM console',
      redirectUris: [new URL('/api/v1/callback', consoleOrigin).href],
    });
    onTestFinished(async () => {
      await database.delete(oauthClients).where(eq(oauthClients.clientId, registration.clientId));
      await database.$client.end();
    });
    const reader = openAuditReader();
    const creation = await reader
      .select({ actor: oauthClientEvents.actorUserId })
      .from(oauthClientEvents)
      .where(
        and(
          eq(oauthClientEvents.clientId, registration.clientId),
          eq(oauthClientEvents.operation, 'created'),
        ),
      )
      .orderBy(desc(oauthClientEvents.id))
      .limit(LATEST_EVENT_COUNT);

    expect(creation).toEqual([{ actor: operator.userId }]);
    await cluster.startConsole(registration);

    const browser = await chromium.launch();
    onTestFinished(async () => browser.close());
    const operatorPage = await browser.newPage({ ignoreHTTPSErrors: true });
    const ownerPage = await browser.newPage({ ignoreHTTPSErrors: true });
    const organizationId = await onboard(operatorPage, issuer, operator, owner.email);
    await administer(ownerPage, consoleOrigin, owner, organizationId);
    const replacementPage = await browser.newPage({ ignoreHTTPSErrors: true });
    await recover(operatorPage, replacementPage, issuer, {
      operatorId: operator.userId,
      replacement,
      organizationId,
    });
  },
  TIMEOUT,
);
