import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE, SETUP_CODE, shot, WORKSPACE } from './helpers';

test.describe.configure({ mode: 'serial' });

test('a fresh install redirects every page to the setup wizard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Welcome to Loop Coder' })).toBeVisible();
  await shot(page, '01-setup-welcome');
});

test('the wizard creates the administrator and the first workspace', async ({ page }) => {
  await page.goto('/setup');
  await page.getByRole('button', { name: 'Get started' }).click();

  // Step 1: the setup code is required.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter the setup code')).toBeVisible();
  await page.getByLabel('Setup code').fill('WRONG-CODE-0000');
  await shot(page, '02-setup-code');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: client-side validation of the admin account.
  await page.getByLabel('Full name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill('something else entirely');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Passwords do not match')).toBeVisible();
  await page.getByLabel('Confirm password').fill(ADMIN.password);
  await shot(page, '03-setup-admin');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: the wrong code is rejected by the server and we land back on the code step.
  await page.getByLabel('Workspace name').fill(WORKSPACE);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByText(/Invalid setup code/)).toBeVisible();
  await page.getByLabel('Setup code').fill(SETUP_CODE.toLowerCase());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, '04-setup-workspace');
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page.getByRole('heading', { name: 'You are all set' })).toBeVisible();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await expect(page.getByRole('heading', { name: WORKSPACE })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  await shot(page, '05-empty-workspace');
  await page.context().storageState({ path: ADMIN_STATE });
});

test('setup cannot be run again', async ({ page, request }) => {
  await page.goto('/setup');
  await expect(page).not.toHaveURL(/\/setup$/);
  const res = await request.post('/api/setup', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: { setupCode: SETUP_CODE, name: 'Mallory', email: 'mallory@e2e.test', password: 'mallory long password', workspaceName: 'Evil' },
  });
  expect(res.status()).toBe(409);
});
