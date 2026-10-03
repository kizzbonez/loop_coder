import { expect, test } from '@playwright/test';
import { ADMIN_STATE, api, login, MEMBER, shot, WORKSPACE } from './helpers';

test.describe.configure({ mode: 'serial' });

test('a new user without workspaces is invited to create one, and cannot reach admin', async ({ page }) => {
  await login(page, MEMBER.email, MEMBER.password);
  await expect(page.getByText('Create your first workspace')).toBeVisible();
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/);
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
});

test('a viewer sees projects read-only', async ({ browser }) => {
  // The admin adds the member as a viewer of the main workspace.
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });
  const ws = await api<{ items: Array<{ id: string; name: string }> }>(adminCtx.request, 'get', '/workspaces');
  const workspace = ws.items.find((w) => w.name === WORKSPACE)!;
  await api(adminCtx.request, 'post', `/workspaces/${workspace.id}/members`, { email: MEMBER.email, role: 'viewer' });
  await adminCtx.close();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, MEMBER.email, MEMBER.password);
  await page.getByRole('link', { name: /SHOP Online Shop/ }).first().click();
  await expect(page.getByText('Read-only access')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause agent' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to Backlog' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await shot(page, '40-viewer-board');
  await ctx.close();
});

test('unknown or forbidden pages show a friendly not-found', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await ctx.newPage();
  await page.goto('/p/6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e6f/board');
  await expect(page.getByText('This project does not exist')).toBeVisible();
  await ctx.close();
});

test('theme preference persists and the layout works on mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await shot(page, '41-mobile-light');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await ctx.close();
});

test('signing out ends the session', async ({ page }) => {
  await login(page, MEMBER.email, MEMBER.password);
  await page.getByRole('button', { name: MEMBER.name }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login/);
});
