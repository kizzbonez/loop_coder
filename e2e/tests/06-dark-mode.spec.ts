import { expect, test } from '@playwright/test';
import { ADMIN_STATE, api, shot } from './helpers';

// With no saved preference the app follows the operating system's colour scheme.
test.use({ storageState: ADMIN_STATE, colorScheme: 'dark' });

test('follows a dark system preference across the main screens', async ({ page, request }) => {
  const projects = await api<{ items: Array<{ id: string; key: string }> }>(request, 'get', '/projects');
  const live = projects.items.find((p) => p.key === 'LIVE')!;

  await page.goto(`/p/${live.id}/board`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('region', { name: 'Backlog', exact: true })).toBeVisible();
  await shot(page, '50-dark-board');

  const card = page.getByRole('region', { name: 'Code Review', exact: true }).getByRole('button', { name: /LIVE-2/ });
  await card.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, '51-dark-drawer');
  await page.keyboard.press('Escape');

  await page.goto(`/p/${live.id}/sprints`);
  await expect(page.getByRole('img', { name: /Burndown/ })).toBeVisible();
  await shot(page, '52-dark-sprints');

  await page.goto(`/p/${live.id}/agent`);
  await expect(page.getByRole('heading', { name: 'Connect your AI agent' })).toBeVisible();
  await shot(page, '53-dark-claude');

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await shot(page, '54-dark-admin');
});
