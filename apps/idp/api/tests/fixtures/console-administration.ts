import type { Page } from 'playwright';

/**
 * Registers a client, defines an installation role, and grants it through the console.
 * @param {Page} page - Owner's signed-in browser with fresh passkey verification.
 * @param {string} consoleOrigin - HTTPS console origin.
 * @param {string} ownerEmail - Member to receive the installation role.
 * @returns {Promise<void>} Resolves after the console rereads the persisted assignment.
 */
export async function registerAndAssign(
  page: Page,
  consoleOrigin: string,
  ownerEmail: string,
): Promise<void> {
  const appName = 'Console fixture app';
  const role = 'viewer';
  await page.goto(new URL('/applications', consoleOrigin).href);
  await page.getByRole('button', { name: 'Register an app' }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByLabel('Name', { exact: true }).fill(appName);
  await dialog.getByLabel('HTTPS callback URL').fill('https://console-fixture.localhost/callback');
  await dialog.getByRole('button', { name: 'Register an app' }).click();
  await dialog.getByRole('heading', { name: 'App credentials' }).waitFor();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page
    .getByRole('link', {
      name: appName,
      exact: true,
    })
    .click();
  await page.getByRole('tab', { name: 'Permissions' }).click();
  await page
    .getByRole('button', {
      name: 'Define role',
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', {
      name: 'Role',
      exact: true,
    })
    .fill(role);
  await page.getByLabel('Permissions (comma-separated)').fill('read');
  await page.getByRole('button', { name: 'Define an installation role' }).click();
  await page
    .getByRole('cell', {
      name: 'read',
      exact: true,
    })
    .waitFor();

  await page
    .getByRole('tab', {
      name: 'Access',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Assign role',
      exact: true,
    })
    .click();
  await page.getByRole('combobox', { name: 'Member' }).click();
  await page
    .getByRole('option', {
      name: ownerEmail,
      exact: true,
    })
    .click();
  await page
    .getByRole('combobox', {
      name: 'Role',
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: role,
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Assign an installation role' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: ownerEmail })
    .getByRole('cell', {
      name: role,
      exact: true,
    })
    .waitFor();
}
