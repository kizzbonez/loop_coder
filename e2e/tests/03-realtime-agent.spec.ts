import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, api, createToken, mcp, mcpInit, shot } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const AC = '- Given a visitor\n- When they act\n- Then it works';
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

let token: string;
let projectId: string;

test.beforeAll(async ({ request }) => {
  // A second project so this spec is independent of the board spec.
  const ws = await api<{ items: Array<{ id: string }> }>(request, 'get', '/workspaces');
  const project = await api<{ id: string }>(request, 'post', '/projects', {
    workspaceId: ws.items[0]!.id,
    name: 'Live Demo',
    key: 'LIVE',
    description: 'Realtime demo project',
  });
  projectId = project.id;
  token = await createToken(request, projectId);
  await mcpInit(request, token, 'claude-code');
});

test('the board updates live while the agent works through MCP', async ({ page, request }) => {
  await page.goto(`/p/${projectId}/board`);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.getByText('Agent offline')).toBeVisible();

  // Kickoff as Project Manager.
  expect(await mcp(request, token, 'get_next_work')).toContain('Project kickoff');
  await expect(page.getByText('Project kickoff as Project Manager')).toBeVisible();
  await mcp(request, token, 'create_work_items', {
    items: [
      { ref: 'cart', type: 'epic', title: 'Shopping cart', refined: true },
      { ref: 'add', title: 'Add to cart', parent: 'cart', story_points: 3, acceptance_criteria: AC, refined: true, priority: 'high' },
      { title: 'Checkout with card', parent: 'cart', story_points: 5, acceptance_criteria: AC, refined: true, depends_on: ['add'] },
    ],
  });
  await expect(column(page, 'Backlog').getByText('Add to cart')).toBeVisible();
  await mcp(request, token, 'complete_kickoff', { summary: 'Backlog ready' });

  // Sprint planning and development: the card moves and glows while the agent works on it.
  expect(await mcp(request, token, 'get_next_work')).toContain('Sprint planning');
  await mcp(request, token, 'start_sprint', { goal: 'Customers can buy', items: ['LIVE-2', 'LIVE-3'] });
  await expect(page.getByText('Customers can buy')).toBeVisible();
  expect(await mcp(request, token, 'get_next_work')).toContain('Software Engineer');
  const working = column(page, 'In Progress').getByRole('button', { name: /LIVE-2/ });
  await expect(working).toBeVisible();
  await expect(working.getByText('Claude Code is working as Software Engineer')).toBeVisible();
  await expect(page.getByText('Claude Code', { exact: true }).first()).toBeVisible();
  await mcp(request, token, 'log_progress', { message: 'Running the unit tests', item: 'LIVE-2' });
  await expect(page.getByText('Running the unit tests').first()).toBeVisible();
  await shot(page, '20-agent-working');

  // Hand over to review.
  await mcp(request, token, 'move_work_item', { item: 'LIVE-2', to: 'review', remark: 'Implemented **add to cart** with tests.' });
  await expect(column(page, 'Code Review').getByRole('button', { name: /LIVE-2/ })).toBeVisible();
  await column(page, 'Code Review').getByRole('button', { name: /LIVE-2/ }).click();
  await expect(page.getByRole('dialog').getByText('add to cart')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Work log')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('humans can pause the agent from the board', async ({ page, request }) => {
  await page.goto(`/p/${projectId}/board`);
  await page.getByRole('button', { name: 'Pause agent' }).click();
  await expect(page.getByText('Agent paused', { exact: true })).toBeVisible();
  expect(await mcp(request, token, 'get_next_work')).toContain('STATUS: PAUSED');
  await page.getByRole('button', { name: 'Resume agent' }).click();
  await expect(page.getByRole('button', { name: 'Pause agent' })).toBeVisible();
  expect(await mcp(request, token, 'get_next_work')).toContain('Code Reviewer');
});

test('questions from the agent reach the human, who answers and resumes', async ({ page, request }) => {
  await page.goto(`/p/${projectId}/board`);
  await mcp(request, token, 'request_human_input', { item: 'LIVE-2', question: 'Should the cart persist across devices?' });
  await expect(page.getByText('1 waiting for you')).toBeVisible();
  const card = column(page, 'Needs Human').getByRole('button', { name: /LIVE-2/ });
  await expect(card).toBeVisible();
  await card.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('The agent needs your input')).toBeVisible();
  await expect(drawer.getByText('Should the cart persist across devices?')).toBeVisible();
  await drawer.getByPlaceholder(/Answer the agent/).fill('Yes, store it server-side per account.');
  await shot(page, '21-needs-human');
  await drawer.getByRole('button', { name: 'Answer & resume' }).click();
  await expect(column(page, 'Code Review').getByRole('button', { name: /LIVE-2/ })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await mcp(request, token, 'get_next_work')).toContain('store it server-side');
});

test('the activity feed and sprint view reflect the work', async ({ page }) => {
  await page.goto(`/p/${projectId}/activity`);
  await expect(page.getByText(/started working on LIVE-2/).first()).toBeVisible();
  await expect(page.getByText(/moved LIVE-2 from In Progress to Code Review/).first()).toBeVisible();
  await shot(page, '22-activity');
  await page.getByRole('link', { name: 'Sprints' }).click();
  await expect(page.getByRole('heading', { name: 'Sprint 1' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Customers can buy').last()).toBeVisible();
  await expect(page.getByRole('img', { name: /Burndown/ })).toBeVisible();
  await shot(page, '23-sprints');
});
