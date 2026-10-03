import { expect, test } from '@playwright/test';
import { ADMIN_STATE, MEMBER, shot } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

test('admin overview shows platform statistics', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await expect(page.getByText('Workspaces', { exact: true }).first()).toBeVisible();
  await shot(page, '30-admin-overview');
});

test('create a user from the admin console', async ({ page }) => {
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Create user' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(MEMBER.name);
  await dialog.getByLabel('Email').fill(MEMBER.email);
  await dialog.getByLabel('Initial password').fill('short');
  await dialog.getByRole('button', { name: 'Create user' }).click();
  await expect(dialog.getByText(/at least 12 characters/)).toBeVisible();
  await dialog.getByLabel('Initial password').fill(MEMBER.password);
  await dialog.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('cell', { name: new RegExp(MEMBER.email) })).toBeVisible();
  await shot(page, '31-admin-users');
});

test('the nine SDLC agent roles are listed and editable', async ({ page }) => {
  await page.goto('/admin/roles');
  for (const role of ['Project Manager', 'Software Architect', 'UI/UX Designer', 'Software Engineer', 'Code Reviewer', 'QA Engineer', 'DevOps Engineer', 'Security Engineer', 'Technical Writer']) {
    await expect(page.getByText(role, { exact: true }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Edit QA Engineer' }).click();
  await expect(page.getByRole('dialog').getByLabel('Instructions')).toContainText('acceptance criterion');
  await page.keyboard.press('Escape');
  await shot(page, '32-admin-roles');
});

test('settings can be changed and take effect', async ({ page, browser }) => {
  await page.goto('/admin/settings');
  await page.getByRole('switch', { name: 'Allow self-registration' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  // Explicitly empty storage: contexts would otherwise inherit the admin login from test.use().
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const anonPage = await anon.newPage();
  await anonPage.goto('/login');
  await expect(anonPage.getByRole('link', { name: 'Create one' })).toBeVisible();
  await anon.close();
  // Switch it back off.
  await page.getByRole('switch', { name: 'Allow self-registration' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await shot(page, '33-admin-settings');
});

test('the audit log records security events', async ({ page }) => {
  await page.goto('/admin/audit');
  await expect(page.getByText('setup.completed')).toBeVisible();
  await expect(page.getByText('admin.user_created')).toBeVisible();
  await page.getByLabel('Filter').selectOption('admin.');
  await expect(page.getByText('setup.completed')).toHaveCount(0);
  await shot(page, '34-admin-audit');
});

test('system page shows the version and downloads a database backup', async ({ page }) => {
  await page.goto('/admin/system');
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download backup' }).click();
  expect((await download).suggestedFilename()).toMatch(/^loopcoder-backup-.*\.db$/);
  await shot(page, '35-admin-system');
});
