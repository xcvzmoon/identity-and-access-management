import type { Locator } from 'playwright';
import { expect } from 'vite-plus/test';

/**
 * Moves keyboard focus to a visible control using the page's tab order.
 * @param {Locator} control - Control that must be reachable by keyboard.
 */
export async function tabTo(control: Locator): Promise<void> {
  const page = control.page();
  await control.waitFor();
  await expect.poll(async () => control.isEnabled()).toBe(true);
  await expect
    .poll(async () => {
      if (await control.evaluate((element) => element === document.activeElement)) {
        return true;
      }
      await page.keyboard.press('Tab');
      return control.evaluate((element) => element === document.activeElement);
    })
    .toBe(true);
}
