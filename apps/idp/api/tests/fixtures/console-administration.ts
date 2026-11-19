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
  const action = page.getByRole('combobox', { name: 'Management action' });
  const installation = page.getByRole('combobox', { name: 'App installation' });

  await page.goto(new URL('/management', consoleOrigin).href);
  await action.selectOption('register');
  await page.getByLabel('Name', { exact: true }).fill(appName);
  await page.getByLabel('HTTPS callback URL').fill('https://console-fixture.localhost/callback');
  await page.getByRole('button', { name: 'Register an app' }).click();
  await page.getByRole('heading', { name: 'App credentials' }).waitFor();

  await action.selectOption('defineRole');
  await installation.selectOption({ label: appName });
  await page
    .getByRole('textbox', {
      name: 'Role',
      exact: true,
    })
    .fill(role);
  await page.getByLabel('Permissions (comma-separated)').fill('read');
  await page.getByRole('button', { name: 'Define an installation role' }).click();
  await page.getByText('viewer · read', { exact: true }).waitFor();

  await action.selectOption('assign');
  await installation.selectOption({ label: appName });
  await page.getByRole('combobox', { name: 'Member' }).selectOption({ label: ownerEmail });
  await page
    .getByRole('combobox', {
      name: 'Role',
      exact: true,
    })
    .selectOption(role);
  await page.getByRole('button', { name: 'Assign an installation role' }).click();
  await page.getByText(`${ownerEmail} · ${appName} · ${role}`, { exact: true }).waitFor();
}
