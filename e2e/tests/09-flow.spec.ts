import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, api, createToken, mcp, mcpInit, shot } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const AC = '- Given a shopper\n- When they act\n- Then it works';
const stage = (page: Page, name: RegExp) => page.getByRole('button', { name });

let claude: string;
let cursor: string;
let projectId: string;

test.beforeAll(async ({ request }) => {
  const ws = await api<{ items: Array<{ id: string }> }>(request, 'get', '/workspaces');
  const project = await api<{ id: string }>(request, 'post', '/projects', {
    workspaceId: ws.items[0]!.id,
    name: 'Flow Demo',
    key: 'FLOW',
    description: 'A small shop, built while we watch the flow',
  });
  projectId = project.id;
  claude = await createToken(request, projectId);
  cursor = await createToken(request, projectId);
  await mcpInit(request, claude, 'claude-code');
  await mcpInit(request, cursor, 'cursor-vscode');
});

test('the Flow tab shows agents moving work through the SDLC live', async ({ page, request }) => {
  await page.goto(`/p/${projectId}/flow`);
  await expect(page.getByRole('heading', { name: 'Flow', exact: true })).toBeVisible();
  await expect(stage(page, /^Backlog: 0 items/)).toBeVisible();
  await expect(page.getByText('No agent is connected.', { exact: false })).toBeVisible();

  // Kickoff: the agent appears at the Kickoff ceremony.
  await mcp(request, claude, 'get_next_work');
  await expect(page.getByRole('button', { name: /Kickoff, in progress/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Claude Code · Project Manager/ })).toBeVisible();
  await mcp(request, claude, 'create_work_items', {
    items: [
      { title: 'Product catalogue', story_points: 3, acceptance_criteria: AC, refined: true, priority: 'high' },
      { title: 'Shopping cart', story_points: 5, acceptance_criteria: AC, refined: true },
      { title: 'Checkout', story_points: 8, acceptance_criteria: AC, refined: true },
    ],
  });
  await expect(stage(page, /^Backlog: 3 items/)).toBeVisible();
  await mcp(request, claude, 'complete_kickoff', { summary: 'Backlog ready' });
  await expect(page.getByRole('button', { name: 'Sprint planning, up next' })).toBeVisible();

  // Planning commits two items; both agents pick one up.
  await mcp(request, claude, 'get_next_work');
  await expect(page.getByRole('button', { name: /Sprint planning, in progress/ })).toBeVisible();
  await mcp(request, claude, 'start_sprint', { goal: 'Shoppers can buy', items: ['FLOW-1', 'FLOW-2'] });
  await mcp(request, claude, 'get_next_work');
  await mcp(request, cursor, 'get_next_work');
  await expect(stage(page, /^In Progress: 2 items, an agent is working here/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Cursor · Software Engineer, on FLOW-/ })).toBeVisible();

  // Review requests changes once, then QA passes it.
  await mcp(request, claude, 'move_work_item', { item: 'FLOW-1', to: 'review', remark: 'Built the catalogue' });
  await expect(stage(page, /^Code Review: 1 item/)).toBeVisible();
  const feed = page.getByRole('log', { name: 'Flow events' });
  await expect(feed.getByText('FLOW-1').first()).toBeVisible();
  await mcp(request, claude, 'get_next_work'); // reviews FLOW-1
  await mcp(request, claude, 'move_work_item', { item: 'FLOW-1', to: 'in_progress', remark: 'Please add paging', kind: 'review' });
  await mcp(request, claude, 'get_next_work');
  await mcp(request, claude, 'move_work_item', { item: 'FLOW-1', to: 'review', remark: 'Paging added' });
  await mcp(request, claude, 'get_next_work');
  await mcp(request, claude, 'move_work_item', { item: 'FLOW-1', to: 'testing', remark: 'Looks good', kind: 'review' });
  await mcp(request, claude, 'get_next_work');
  await mcp(request, claude, 'move_work_item', { item: 'FLOW-1', to: 'done', remark: 'All checks pass', kind: 'test_report' });
  await expect(stage(page, /^Done: 1 item/)).toBeVisible();
  await expect(page.locator('[data-edge="review->in_progress"] text')).toContainText('changes requested · 1');

  // Cursor needs a decision from a person.
  await mcp(request, cursor, 'request_human_input', { item: 'FLOW-2', question: 'Should the cart persist across devices?' });
  await expect(stage(page, /^Needs Human: 1 item/)).toBeVisible();
  await mcp(request, claude, 'log_progress', { message: 'Writing the checkout tests' });
  await page.waitForTimeout(400);
  await shot(page, '70-flow-live');

  // Stage details list the items and open them.
  await stage(page, /^Needs Human: 1 item/).click();
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Needs Human' }) });
  await expect(panel.getByText('Shopping cart')).toBeVisible();
});

test('the history can be replayed, and an item followed on its journey', async ({ page }) => {
  await page.goto(`/p/${projectId}/flow`);
  await page.getByRole('radio', { name: 'Replay' }).click();
  await expect(page).toHaveURL(/replay=all/);
  // At the start of the history the backlog was empty.
  await expect(stage(page, /^Backlog: 0 items/)).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Replay position' });
  const total = Number(await slider.getAttribute('max'));
  expect(total).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.getByRole('button', { name: 'Step forward' }).click();
  await expect(page.getByRole('heading', { name: 'Replayed events' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Replay speed' }).selectOption('4');
  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause replay' }).click();
  expect(Number(await slider.inputValue())).toBeGreaterThan(2);
  await slider.fill(String(total));
  await expect(stage(page, /^Done: 1 item/)).toBeVisible();
  await shot(page, '71-flow-replay');

  // Follow FLOW-1 from its details.
  await page.getByRole('radio', { name: 'Live' }).click();
  await page.getByRole('log', { name: 'Flow events' }).getByRole('button', { name: 'FLOW-1' }).first().click();
  await page.getByRole('button', { name: 'Replay journey' }).click();
  await expect(page).toHaveURL(/replay=/);
  await expect(page.getByText('Following')).toBeVisible();
  const journey = page.locator('section', { has: page.getByRole('heading', { name: 'Journey' }) });
  // Created, committed, started, review, changes requested, review again, QA, done.
  await expect(journey.getByRole('listitem')).toHaveCount(8);
  await expect(journey.getByRole('listitem').last()).toContainText('Done');
  await journey.getByRole('listitem').last().getByRole('button').click();
  await expect(page.locator('[data-edge="review->in_progress"] path.flow-edge-journey')).toHaveCount(1);
  await shot(page, '72-flow-journey');
});

test('on a phone the flow is laid out top to bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${projectId}/flow`);
  await expect(stage(page, /^Done: 1 item/)).toBeVisible();
  const backlog = await stage(page, /^Backlog:/).boundingBox();
  const done = await stage(page, /^Done:/).boundingBox();
  expect(done!.y).toBeGreaterThan(backlog!.y + 300);
  const scrollWidth = await page.evaluate(() => document.querySelector('main')!.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(392);
  await shot(page, '73-flow-mobile');
});
