import { expect, test } from '@playwright/test';
import { ADMIN_STATE, api, mcp, mcpInit } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const AC = '- Given a visitor\n- When they act\n- Then it works';
let projectId: string;

test.beforeAll(async ({ request }) => {
  const ws = await api<{ items: Array<{ id: string }> }>(request, 'get', '/workspaces');
  const project = await api<{ id: string }>(request, 'post', '/projects', { workspaceId: ws.items[0]!.id, name: 'Team Agents', key: 'TEAM', description: 'Several agents at once' });
  projectId = project.id;
});

test('each agent gets its own roles, chosen on its token', async ({ page, request }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'New token' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Reviewer bot');
  await dialog.getByLabel('Only these roles').check();
  await expect(dialog.getByText('Choose at least one role.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await dialog.getByLabel('Code Reviewer').check();
  await dialog.getByLabel('QA Engineer').check();
  await dialog.getByRole('button', { name: 'Create token' }).click();
  const secret = (await dialog.locator('pre').first().innerText()).trim();
  expect(secret).toMatch(/^lc_pat_/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Reviewer bot' });
  await expect(row.getByText('Roles: Code Reviewer, QA Engineer')).toBeVisible();

  // The agent hears about its roles and waits: nothing for a reviewer before the kickoff.
  await mcpInit(request, secret, 'claude-code');
  expect(await mcp(request, secret, 'get_project_context', { project: 'TEAM' })).toContain('Roles: `code_reviewer`, `qa_engineer`');
  expect(await mcp(request, secret, 'get_next_work', { project: 'TEAM' })).toMatch(/STATUS: WAITING[\s\S]*Project Manager/);

  // Roles can be changed later.
  await row.getByRole('button', { name: 'Roles' }).click();
  await page.getByRole('dialog').getByLabel('Every role (one agent does everything)').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row.getByText('Roles: Every role')).toBeVisible();
  expect(await mcp(request, secret, 'get_next_work', { project: 'TEAM' })).toContain('Project kickoff');
  await mcp(request, secret, 'create_work_items', { project: 'TEAM', items: [{ title: 'Sign up', story_points: 3, acceptance_criteria: AC, refined: true }] });
  await mcp(request, secret, 'complete_kickoff', { project: 'TEAM', summary: 'ok' });
});

test('the Agent tab lists your agents with their roles, and changes them in place', async ({ page }) => {
  await page.goto(`/p/${projectId}/agent`);
  const agents = page.getByRole('region', { name: 'Your agents on this project' });
  await expect(agents.getByText('Reviewer bot')).toBeVisible();
  await expect(agents.getByLabel('Roles of Reviewer bot').getByText('Every role')).toBeVisible();
  await agents.getByRole('button', { name: 'Roles for Reviewer bot' }).click();
  const dialog = page.getByRole('dialog');
  // The roles are listed even before narrowing them down.
  await expect(dialog.getByLabel('QA Engineer')).toBeDisabled();
  await dialog.getByLabel('Only these roles').check();
  await dialog.getByLabel('QA Engineer').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(agents.getByLabel('Roles of Reviewer bot').getByText('QA Engineer')).toBeVisible();
});

test('new projects give each agent a git worktree and each item a branch', async ({ page }) => {
  await page.goto(`/p/${projectId}/settings`);
  await expect(page.getByLabel('Working copies')).toHaveValue('worktrees');
  await expect(page.getByLabel('Base branch')).toHaveValue('main');
  await expect(page.getByText('.worktrees/<agent>')).toBeVisible();

  // Unsafe branch names are refused.
  await page.getByLabel('Base branch').fill('main; rm -rf ~');
  await page.getByRole('region', { name: 'Git' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/letters, digits/)).toBeVisible();
  await page.getByLabel('Base branch').fill('develop');
  await page.getByRole('region', { name: 'Git' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Git settings saved')).toBeVisible();

  // The item drawer shows the branch that carries the item's work.
  await page.goto(`/p/${projectId}/backlog`);
  await page.getByRole('button', { name: /TEAM-1/ }).first().click();
  await expect(page.getByRole('dialog').getByText('item/TEAM-1')).toBeVisible();
});
