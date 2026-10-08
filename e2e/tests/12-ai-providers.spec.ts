import { expect, test } from '@playwright/test';
import { ADMIN_STATE } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

// Not a real key: the provider rejects it, which is exactly what the test checks.
const FAKE_KEY = 'sk-e2e-not-a-real-key-0000000000-ABCD';

test('an administrator stores an AI provider key safely and tests it through the egress gateway', async ({ page }) => {
  await page.goto('/admin/ai-providers');
  await expect(page.getByText('No AI providers yet')).toBeVisible();
  await expect(page.getByText('Secret storage is not set up yet')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add provider' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Provider').selectOption('custom');
  await dialog.getByLabel('Name').fill('Example compatible');
  await dialog.getByLabel('Base URL').fill('https://example.com/v1');
  await dialog.getByLabel('API key').fill(FAKE_KEY);
  await dialog.getByRole('button', { name: 'Add and test' }).click();

  const row = page.getByRole('row').filter({ hasText: 'Example compatible' });
  await expect(row).toBeVisible();
  await expect(row.getByText('…ABCD')).toBeVisible();
  // The test went out through the gateway: the provider answered (404 for this address) or, on a
  // machine without internet, could not be reached. Either way it failed safely and said why.
  await expect(row.getByText('Failed')).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText(/404: check the base URL|Could not reach the provider|No answer within/)).toBeVisible();
  await expect(page.getByText('The server can reach: example.com.')).toBeVisible();
  // The key never comes back to the browser.
  expect(await page.content()).not.toContain(FAKE_KEY);

  // Edit without retyping the key, then delete.
  await page.getByRole('button', { name: 'Edit Example compatible' }).click();
  await expect(page.getByRole('dialog').getByLabel('API key')).toHaveAttribute('placeholder', /Leave empty to keep the saved key \(…ABCD\)/);
  await page.getByRole('dialog').getByLabel('Default model').fill('example-model');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row.getByText('example-model')).toBeVisible();
  await page.getByRole('button', { name: 'Delete Example compatible' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No AI providers yet')).toBeVisible();
  await expect(page.getByText('The server can reach: nothing (no enabled providers).')).toBeVisible();
});
