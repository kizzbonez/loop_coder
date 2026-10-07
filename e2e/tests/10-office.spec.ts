import { expect, test } from '@playwright/test';
import { ADMIN_STATE, api, createToken, mcp, mcpInit, shot } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const AC = '- Given a visitor\n- When they act\n- Then it works';
let claude: string;
let cursor: string;
let projectId: string;

test.beforeAll(async ({ request }) => {
  const ws = await api<{ items: Array<{ id: string }> }>(request, 'get', '/workspaces');
  const project = await api<{ id: string }>(request, 'post', '/projects', {
    workspaceId: ws.items[0]!.id,
    name: 'Office Demo',
    key: 'DESK',
    description: 'A booking site, built in the pixel office',
  });
  projectId = project.id;
  claude = await createToken(request, projectId);
  cursor = await createToken(request, projectId);
  await mcpInit(request, claude, 'claude-code');
  await mcpInit(request, cursor, 'cursor-vscode');
});

test('agents walk into the pixel office, work at their stations and talk', async ({ page, request }) => {
  await page.goto(`/p/${projectId}/office`);
  await expect(page.getByRole('heading', { name: 'Office', exact: true })).toBeVisible();
  const canvas = page.getByRole('application', { name: /Agent office/ });
  await expect(canvas).toBeVisible();
  // One character per role is already at work; no agent plays any of them yet.
  await expect(page.getByRole('heading', { name: /^Team · \d+$/ })).toBeVisible();
  await expect(page.getByText('No agent connected.', { exact: false })).toBeVisible();
  const team = page.locator('section', { has: page.getByRole('heading', { name: /^Team · / }) });
  await expect(team.getByText('Software Engineer', { exact: true })).toBeVisible();
  await expect(team.getByText('QA Engineer', { exact: true })).toBeVisible();
  const row = (role: string) => team.getByRole('listitem').filter({ has: page.getByText(role, { exact: true }) });

  // Kickoff in the meeting room.
  await mcp(request, claude, 'get_next_work');
  await expect(row('Project Manager')).toContainText('Claude Code');
  await expect(page.getByText('Agents: Claude Code')).toBeVisible();
  const chatter = page.getByRole('log', { name: 'Office chatter' });
  await expect(chatter).toContainText('Kickoff time!');
  await mcp(request, claude, 'create_work_items', {
    items: [
      { title: 'Search rooms', story_points: 3, acceptance_criteria: AC, refined: true, priority: 'high' },
      { title: 'Book a room', story_points: 5, acceptance_criteria: AC, refined: true },
    ],
  });
  await mcp(request, claude, 'complete_kickoff', { summary: 'Backlog ready' });
  await mcp(request, claude, 'get_next_work');
  await mcp(request, claude, 'start_sprint', { goal: 'Guests can book', items: ['DESK-1', 'DESK-2'] });

  // Both agents get to work; each walks to the desk of its role and says what it is doing.
  await mcp(request, claude, 'get_next_work');
  await mcp(request, cursor, 'get_next_work');
  // Both agents play Software Engineer: the engineer and a colleague work side by side.
  await expect(row('Software Engineer')).toContainText('Claude Code');
  await expect(row('Software Engineer')).toContainText('Cursor');
  await expect(row('Project Manager')).toContainText('At their desk');
  await mcp(request, claude, 'log_progress', { message: 'Building the **search** page', item: 'DESK-1' });
  await expect(chatter).toContainText('Building the search page');
  await mcp(request, cursor, 'add_remark', { item: 'DESK-2', body: 'Designing the booking form', kind: 'design' });
  await expect(chatter).toContainText('Designing the booking form');
  await mcp(request, cursor, 'request_human_input', { item: 'DESK-2', question: 'Can guests book without an account?' });
  await expect(chatter).toContainText('Can guests book without an account?');
  await page.waitForTimeout(2500); // let everyone walk to their stations
  await shot(page, '80-office');

  // The canvas really draws (not blank).
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 997) colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    return colours.size;
  });
  expect(painted).toBeGreaterThan(20);
});

test('things react when poked, with the keyboard too', async ({ page }) => {
  await page.goto(`/p/${projectId}/office`);
  const canvas = page.getByRole('application', { name: /Agent office/ });
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(canvas).toHaveAttribute('aria-label', /now: /);
  // Walk the pointer to the rubber duck and squeeze it.
  for (let i = 0; i < 30; i++) {
    if (/now: Rubber duck/.test((await canvas.getAttribute('aria-label')) ?? '')) break;
    await page.keyboard.press('ArrowRight');
  }
  await expect(canvas).toHaveAttribute('aria-label', /now: Rubber duck/);
  await page.keyboard.press('Enter');
  await expect(page.locator('p.sr-only[aria-live="polite"]').filter({ hasText: 'Squeak!' })).toHaveCount(1);
  await shot(page, '81-office-poke');

  // Click the help desk bell: it knows one item is waiting for an answer.
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + ((27 * 16 + 8) / 512) * box.width, box.y + ((4 * 16 + 6) / 288) * box.height);
  await expect(page.locator('p.sr-only[aria-live="polite"]')).toHaveText('1 item needs your answer!');
});

test('the game menu changes music, sound and text settings and remembers them', async ({ page }) => {
  await page.goto(`/p/${projectId}/office`);
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Game menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Music: OFF' }).click();
  await expect(menu.getByRole('button', { name: 'Music: ON' })).toBeVisible();
  await menu.getByRole('button', { name: /^Track: / }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(menu.getByRole('button', { name: 'Track: Deep Focus' })).toBeVisible();
  await menu.getByRole('button', { name: 'Name tags: ON' }).click();
  await menu.getByRole('button', { name: /^Text speed: / }).focus();
  await page.keyboard.press('ArrowRight');
  await shot(page, '82-office-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lc-office-settings') ?? '{}'));
  expect(stored).toMatchObject({ music: true, track: 'focus', names: false, textSpeed: 'fast' });
  await page.reload();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Track: Deep Focus' })).toBeVisible();
  await page.getByRole('button', { name: 'Music: ON' }).click(); // leave it off for other tests
});

test('the office replays the history and works on a phone and in dark mode', async ({ page }) => {
  await page.goto(`/p/${projectId}/office`);
  await page.getByRole('radio', { name: 'Replay' }).click();
  await expect(page).toHaveURL(/replay=all/);
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.getByRole('button', { name: 'Step forward' }).click();
  await expect(page.getByRole('heading', { name: 'Replayed chatter' })).toBeVisible();
  await expect(page.getByRole('log', { name: 'Office chatter' })).toContainText('Kickoff time!');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('radio', { name: 'Live' }).click();
  await page.waitForTimeout(1500);
  await shot(page, '83-office-dark');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const scrollWidth = await page.evaluate(() => document.querySelector('main')!.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(392);
  await shot(page, '84-office-mobile');
});
