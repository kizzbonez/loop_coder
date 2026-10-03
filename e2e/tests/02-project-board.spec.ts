import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN_STATE, shot } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const column = (page: Page, name: string): Locator => page.getByRole('region', { name, exact: true });

async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Move in steps so dnd-kit's pointer sensor (6px activation distance) kicks in.
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 20 });
  await page.mouse.up();
}

test('create a project and get connection instructions for every agent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name').fill('Online Shop');
  await expect(page.getByLabel('Key')).toHaveValue('OS');
  await page.getByLabel('Key').fill('SHOP');
  await page.getByLabel('Goal and requirements').fill('A small web shop for handmade candles with a cart and checkout.');
  await shot(page, '10-new-project');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/\/p\/[0-9a-f-]+\/agent$/);
  await expect(page.getByRole('heading', { name: 'Connect your AI agent' })).toBeVisible();
  await page.getByRole('button', { name: 'Create project token' }).click();
  await expect(page.getByText('Copy it now')).toBeVisible();
  const secret = await page.locator('pre').filter({ hasText: /^lc_pat_/ }).first().textContent();
  expect(secret).toMatch(/^lc_pat_[A-Za-z0-9_-]{43}$/);
  await expect(page.locator('pre').filter({ hasText: 'claude mcp add --transport http loopcoder' })).toContainText(secret!);
  await expect(page.getByText('/mcp__loopcoder__work SHOP').first()).toBeVisible();
  await shot(page, '11-connect-claude');

  // Instructions for other MCP clients carry the same token.
  await page.getByRole('radio', { name: 'Cursor' }).click();
  await expect(page.getByText('.cursor/mcp.json').first()).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: '"mcpServers"' }).first()).toContainText(secret!);
  await page.getByRole('radio', { name: 'VS Code' }).click();
  await expect(page.locator('pre').filter({ hasText: '"type": "http"' }).first()).toContainText(secret!);
  await page.getByRole('radio', { name: 'Other MCP client' }).click();
  await expect(page.locator('pre').filter({ hasText: 'mcp-remote' })).toContainText(secret!);
  await expect(page.locator('pre').filter({ hasText: 'get_next_work with project "SHOP"' })).toBeVisible();
  await page.getByRole('radio', { name: 'Windows' }).click();
  await expect(page.locator('pre').filter({ hasText: 'mkdir workspaces\\acme-labs\\shop -Force' })).toBeVisible();
  await page.getByRole('radio', { name: 'macOS / Linux' }).click();
  await expect(page.locator('pre').filter({ hasText: 'mkdir -p workspaces/acme-labs/shop' })).toBeVisible();
  await page.getByRole('radio', { name: 'Claude Code' }).click();
});

test('the board shows the SDLC workflow with agent roles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /SHOP Online Shop/ }).first().click();
  await expect(page).toHaveURL(/\/board$/);
  for (const name of ['Backlog', 'To Do', 'In Progress', 'Code Review', 'QA / Testing', 'Needs Human', 'Done']) {
    await expect(column(page, name)).toBeVisible();
  }
  await expect(column(page, 'Backlog').getByText('Project Manager')).toBeVisible();
  await expect(column(page, 'Code Review').getByText('Code Reviewer')).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
});

test('quick-add, edit in the drawer, comment, and drag between columns', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /SHOP Online Shop/ }).first().click();
  await column(page, 'Backlog').getByRole('button', { name: 'Add to Backlog' }).click();
  await page.getByPlaceholder('What needs to be done?').fill('Customers can browse candles');
  await page.getByPlaceholder('What needs to be done?').press('Enter');
  const card = column(page, 'Backlog').getByRole('button', { name: /SHOP-1: Customers can browse candles/ });
  await expect(card).toBeVisible();

  // Edit in the drawer.
  await card.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByLabel('Title')).toHaveValue('Customers can browse candles');
  await drawer.getByLabel('Title').fill('Customers can browse the candle catalogue');
  await drawer.getByLabel('Title').press('Enter');
  await drawer.getByLabel('Priority').selectOption('high');
  await drawer.getByLabel('Story points').selectOption('3');
  await drawer.getByPlaceholder(/Add a comment/).fill('Please include **search** by scent.');
  await drawer.getByRole('button', { name: 'Comment' }).click();
  await expect(drawer.locator('strong', { hasText: 'search' })).toBeVisible();
  await shot(page, '12-task-drawer');
  await page.keyboard.press('Escape');
  await expect(column(page, 'Backlog').getByText('Customers can browse the candle catalogue')).toBeVisible();

  // Drag to To Do and confirm it persisted.
  await dragTo(page, column(page, 'Backlog').getByRole('button', { name: /SHOP-1/ }), column(page, 'To Do'));
  await expect(column(page, 'To Do').getByRole('button', { name: /SHOP-1/ })).toBeVisible();
  await page.reload();
  await expect(column(page, 'To Do').getByRole('button', { name: /SHOP-1/ })).toBeVisible();
  await shot(page, '13-board');
});

test('the backlog view lists items with readiness', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /SHOP Online Shop/ }).first().click();
  await page.getByRole('link', { name: 'Backlog' }).click();
  await page.getByLabel('Title').fill('Gift wrapping option');
  await page.getByRole('button', { name: 'Add to backlog' }).click();
  await expect(page.getByText('Gift wrapping option')).toBeVisible();
  await expect(page.getByText('Draft').first()).toBeVisible();
  await shot(page, '14-backlog');
});
