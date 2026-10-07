import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { api, mcp, mcpInit } from '../tests/helpers';

/**
 * Builds a realistic demo ("Candle Shop", worked by Claude Code and Cursor over MCP) on a fresh
 * stack and captures the screenshots used in docs/USER_GUIDE.md.   npm run docs:screenshots
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../docs/images/guide');
const WORKSPACES = resolve(here, '../..', process.env.E2E_WORKSPACES ?? './e2e/.workspaces-guide');
mkdirSync(OUT, { recursive: true });

const ADMIN = { name: 'Maria Santos', email: 'maria@solamari.example', password: 'correct horse battery staple' };
const MEMBER = { name: 'Leo Cruz', email: 'leo@solamari.example', password: 'another long passphrase' };
const SETUP_CODE = 'E2E-SETUP-CODE-0001';
const P = { project: 'CANDLE' };
const AC = (...lines: string[]) => lines.map((l) => `- ${l}`).join('\n');

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Toast notifications are transient; keep them out of the documentation images.
  await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' }).catch(() => undefined);
  await page.waitForTimeout(400);
}

async function snap(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), animations: 'disabled' });
}

/** Grow the viewport so a page that scrolls internally is captured completely. */
async function snapTall(page: Page, name: string): Promise<void> {
  await settle(page);
  const extra = await page.evaluate(() =>
    Math.max(0, ...[...document.querySelectorAll<HTMLElement>('*')].map((el) => {
      const style = getComputedStyle(el);
      return /(auto|scroll)/.test(style.overflowY) ? el.scrollHeight - el.clientHeight : 0;
    })),
  );
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: Math.min(size.height + extra, 4200) });
  await snap(page, name);
  await page.setViewportSize(size);
}

async function snapEl(locator: Locator, name: string): Promise<void> {
  await locator.page().waitForTimeout(300);
  await locator.screenshot({ path: resolve(OUT, `${name}.png`), animations: 'disabled' });
}

function agent(request: APIRequestContext, token: string) {
  return (tool: string, args: Record<string, unknown> = {}) => mcp(request, token, tool, args);
}

function writeDemoCode(): void {
  const root = resolve(WORKSPACES, 'solamari-web', 'candle');
  const files: Record<string, string> = {
    'README.md': '# Candle Shop\n\nOnline shop for handmade soy candles.\n\n```bash\nnpm install\nnpm run dev\n```\n',
    'package.json': JSON.stringify({ name: 'candle-shop', private: true, scripts: { dev: 'next dev', test: 'vitest run' } }, null, 2),
    'docs/adr/0001-tech-stack.md': '# ADR-0001: Tech stack\n\n## Decision\nNext.js 15 + TypeScript, PostgreSQL with Prisma, Stripe Checkout.\n',
    'lib/filters.ts': [
      "export type Scent = 'lavender' | 'vanilla' | 'sandalwood' | 'citrus';",
      '',
      'export function parseScent(value: string | null): Scent | undefined {',
      "  const scents: Scent[] = ['lavender', 'vanilla', 'sandalwood', 'citrus'];",
      '  return scents.find((s) => s === value);',
      '}',
      '',
    ].join('\n'),
    'app/candles/page.tsx': [
      "import { parseScent } from '@/lib/filters';",
      "import { listCandles } from '@/lib/catalogue';",
      "import { ScentFilter } from './scent-filter';",
      '',
      'export default async function CandlesPage({ searchParams }: { searchParams: { scent?: string } }) {',
      '  const scent = parseScent(searchParams.scent ?? null);',
      '  const candles = await listCandles({ scent });',
      '  return (',
      '    <main className="mx-auto max-w-6xl p-6">',
      '      <h1 className="text-3xl font-semibold">Our candles</h1>',
      '      <ScentFilter active={scent} />',
      '      <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">',
      '        {candles.map((c) => (',
      '          <li key={c.id}>{c.name}</li>',
      '        ))}',
      '      </ul>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n'),
  };
  for (const [file, content] of Object.entries(files)) {
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

test('capture the user guide screenshots', async ({ page, browser, request }) => {
  // ---------------------------------------------------------------- 1. First-run setup
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Loop Coder' })).toBeVisible();
  await snap(page, '01-setup-welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await snap(page, '02-setup-code');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Full name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill(ADMIN.password);
  await snap(page, '03-setup-admin');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Workspace name').fill('Solamari Web');
  await snap(page, '04-setup-workspace');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'You are all set' })).toBeVisible();
  await snap(page, '05-setup-done');
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  await snap(page, '06-workspace-empty');

  // ---------------------------------------------------------------- 2. Project + agent connection
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name').fill('Candle Shop');
  await page.getByLabel('Key').fill('CANDLE');
  await page
    .getByLabel('Goal and requirements')
    .fill(
      'An online shop for our handmade soy candles.\n\nCustomers browse candles by scent, see product details, add them to a cart and pay with Stripe. They receive an order confirmation email. Staff manage products and orders.\n\nPrefer Next.js + TypeScript + PostgreSQL. Mobile-first, accessible (WCAG 2.2 AA).',
    );
  await snap(page, '07-new-project');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your AI agent' })).toBeVisible();
  const projectId = page.url().match(/\/p\/([0-9a-f-]+)\//)![1]!;
  await page.getByRole('radio', { name: 'Windows' }).click();
  await snap(page, '08-agent-tab');
  await page.getByRole('button', { name: 'Create project token' }).click();
  const secret = (await page.locator('pre').filter({ hasText: /^lc_pat_/ }).first().textContent())!;
  await snapTall(page, '09-agent-tab-claude-code');
  await page.getByRole('radio', { name: 'Cursor' }).click();
  await snapEl(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Connect your AI agent' }) }), '10-agent-tab-cursor');
  await page.getByRole('radio', { name: 'Other MCP client' }).click();
  await snapEl(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Connect your AI agent' }) }), '11-agent-tab-other');
  await page.getByRole('radio', { name: 'Claude Code' }).click();

  // ---------------------------------------------------------------- 3. Two agents work the board over MCP
  const cursorToken = (await api<{ secret: string }>(page.request, 'post', '/account/tokens', { name: 'Cursor · CANDLE', expiresInDays: 7, projectId })).secret;
  await mcpInit(request, secret, 'claude-code');
  await mcpInit(request, cursorToken, 'cursor-vscode');
  const claude = agent(request, secret);
  const cursor = agent(request, cursorToken);

  await claude('get_next_work', P); // kickoff as Project Manager
  await claude('update_project_notes', {
    ...P,
    text: '## Vision\nThe easiest way to buy handmade candles online.\n\n## Tech stack\n- Next.js 15 + TypeScript\n- PostgreSQL + Prisma\n- Stripe Checkout\n\n## Conventions\n- Commits reference item keys (e.g. "CANDLE-5: …")\n- Every story has unit tests and, for UI, a Playwright test',
  });
  await claude('create_work_items', {
    ...P,
    items: [
      { ref: 'cat', type: 'epic', title: 'Product catalogue', description: 'Customers discover and explore candles.', refined: true, priority: 'high' },
      { ref: 'cart', type: 'epic', title: 'Cart & checkout', description: 'Customers buy candles securely.', refined: true, priority: 'high' },
      { ref: 'adr', type: 'task', title: 'Architecture and tech stack decision (ADR-0001)', assigned_role: 'architect', story_points: 2, priority: 'critical', refined: true, acceptance_criteria: AC('ADR in docs/adr/0001-tech-stack.md', 'Project scaffolded with lint and tests', 'CI runs on every push') },
      { ref: 'ds', type: 'task', title: 'Design system and key screens', assigned_role: 'ui_designer', story_points: 3, priority: 'high', refined: true, acceptance_criteria: AC('Colour tokens with dark mode', 'Wireframes for catalogue, product and cart', 'WCAG 2.2 AA contrast') },
      {
        ref: 'browse', title: 'Browse candles by scent', parent: 'cat', story_points: 3, priority: 'high', refined: true, labels: ['frontend'],
        description: 'As a shopper, I want to filter candles by scent so that I quickly find ones I like.',
        acceptance_criteria: AC('Given the catalogue page', 'When I pick a scent filter', 'Then only matching candles are shown', 'And the filter is reflected in the URL'),
      },
      { ref: 'detail', title: 'Product detail page', parent: 'cat', story_points: 3, priority: 'medium', refined: true, labels: ['frontend'], acceptance_criteria: AC('Shows photos, scent notes, burn time and price', 'Works on mobile') },
      { ref: 'search', title: 'Search by name and scent', parent: 'cat', story_points: 5, priority: 'medium', refined: true, depends_on: ['browse'], acceptance_criteria: AC('Typo-tolerant search', 'Results within 300 ms') },
      { ref: 'add', title: 'Add candles to the cart', parent: 'cart', story_points: 3, priority: 'medium', refined: true, labels: ['frontend', 'api'], acceptance_criteria: AC('Cart persists per account', 'Quantity can be changed') },
      { ref: 'pay', title: 'Checkout with Stripe', parent: 'cart', story_points: 8, priority: 'high', refined: true, depends_on: ['add'], labels: ['payments'], acceptance_criteria: AC('Stripe Checkout session', 'Webhook marks the order paid') },
      { ref: 'mail', title: 'Order confirmation email', parent: 'cart', story_points: 2, priority: 'low', refined: true, depends_on: ['pay'], acceptance_criteria: AC('Sent after payment', 'Lists items and total') },
      { ref: 'ship', type: 'spike', title: 'Evaluate shipping providers', priority: 'medium' },
      { title: 'Gift wrapping option', priority: 'low' },
    ],
  });
  await claude('complete_kickoff', { ...P, summary: 'Vision, tech stack and initial backlog in place' });

  // Refinement: one question for the human, one refined idea.
  await claude('get_next_work', P); // CANDLE-11 (spike)
  await claude('request_human_input', { item: 'CANDLE-11', question: 'Which countries do you ship to, and do you need same-day delivery in Metro Manila? This decides which shipping APIs to evaluate.' });
  await claude('get_next_work', P); // CANDLE-12
  await claude('update_work_item', { item: 'CANDLE-12', story_points: 1, description: 'As a gift buyer, I want gift wrapping so that I can send candles directly as presents.', acceptance_criteria: AC('Optional gift wrap at checkout', 'Gift note up to 200 characters') });
  await claude('mark_refined', { item: 'CANDLE-12', summary: 'Rewritten as a user story with acceptance criteria; 1 point.' });

  // Sprint planning.
  await claude('get_next_work', P);
  await claude('start_sprint', { ...P, goal: 'Customers can browse the catalogue and add candles to the cart', items: ['CANDLE-3', 'CANDLE-4', 'CANDLE-5', 'CANDLE-6', 'CANDLE-8'] });

  // Architecture and design.
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-3', to: 'review', kind: 'design', remark: '## ADR-0001\n- Next.js 15 (App Router) + TypeScript\n- PostgreSQL 17 with Prisma\n- Stripe Checkout\n\nScaffolded the app; CI runs lint and tests.' });
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-3', to: 'done', kind: 'review', remark: 'Approved: clear trade-offs, CI green.' });
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-4', to: 'review', kind: 'design', remark: 'Design tokens in `src/styles/tokens.css`, wireframes in `docs/design/`. Contrast checked (AA).' });
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-4', to: 'done', kind: 'review', remark: 'Approved.' });

  // A story with a review round-trip and a QA test report.
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-5', to: 'review', kind: 'work_log', remark: 'Implemented the scent filter with URL sync.\n\n**Files:** `app/candles/page.tsx`, `lib/filters.ts`\n**Tests:** `npm test` → 14 passed' });
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-5', to: 'in_progress', kind: 'review', remark: 'Changes requested:\n1. Debounce the filter so the URL is not rewritten on every keystroke.\n2. Add a test for an unknown scent in the URL.' });
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-5', to: 'review', kind: 'work_log', remark: 'Addressed both points: 300 ms debounce; unknown scents fall back to "All". 16 tests pass.' });
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-5', to: 'testing', kind: 'review', remark: 'Looks good to me.' });
  await claude('get_next_work', P);
  await claude('move_work_item', {
    item: 'CANDLE-5',
    to: 'done',
    kind: 'test_report',
    remark: '| Acceptance criterion | Result |\n|---|---|\n| Only matching candles are shown | ✅ pass |\n| Filter is reflected in the URL | ✅ pass |\n\n`npm test` → 16 passed · Playwright → 4 passed',
  });

  // Product page reaches QA; Cursor picks up the QA while Claude Code starts the cart.
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-6', to: 'review', kind: 'work_log', remark: 'Product page with gallery, scent notes and burn time.' });
  await claude('get_next_work', P);
  await claude('move_work_item', { item: 'CANDLE-6', to: 'testing', kind: 'review', remark: 'Approved.' });
  await cursor('get_next_work', P);
  await cursor('log_progress', { ...P, item: 'CANDLE-6', message: 'Verifying the acceptance criteria on mobile' });
  await claude('get_next_work', P);
  await claude('log_progress', { ...P, item: 'CANDLE-8', message: 'Running the test suite' });

  // A human comment and a teammate.
  const tasks = await api<{ items: Array<{ id: string; key: string }> }>(page.request, 'get', `/projects/${projectId}/tasks`);
  const id = (key: string) => tasks.items.find((t) => t.key === key)!.id;
  await api(page.request, 'post', `/tasks/${id('CANDLE-8')}/remarks`, { body: 'Please also allow a short gift note per cart item.', kind: 'comment', resume: false });
  await api(page.request, 'post', '/admin/users', { ...MEMBER, role: 'user' });
  const ws = await api<{ items: Array<{ id: string }> }>(page.request, 'get', '/workspaces');
  await api(page.request, 'post', `/workspaces/${ws.items[0]!.id}/members`, { email: MEMBER.email, role: 'editor' });
  writeDemoCode();

  // ---------------------------------------------------------------- 4. Board, items, views
  await page.goto(`/p/${projectId}/board`);
  await expect(page.getByText('Cursor is working as QA Engineer')).toBeVisible();
  await expect(page.getByText('Claude Code is working as Software Engineer')).toBeVisible();
  await snap(page, '12-board');
  await snapEl(page.getByRole('region', { name: 'In Progress', exact: true }).getByRole('button', { name: /CANDLE-8/ }), '13-card-working');
  await snapEl(page.getByRole('button', { name: 'Pause agent' }).locator('..'), '14-agent-status');
  await snapEl(page.getByRole('region', { name: 'To Do', exact: true }).locator('header'), '15-column-header');

  // Flow view: live graph, then CANDLE-5's journey (it went back from review once).
  await page.goto(`/p/${projectId}/flow`);
  await expect(page.getByRole('button', { name: /^Cursor · QA Engineer/ })).toBeVisible();
  await expect(page.locator('[data-edge="review->in_progress"] text')).toContainText('changes requested');
  await page.waitForTimeout(1200); // let the agents glide into place
  await snap(page, '35-flow');
  await page.goto(`/p/${projectId}/flow?replay=${id('CANDLE-5')}`);
  const position = page.getByRole('slider', { name: 'Replay position' });
  await position.fill(await position.getAttribute('max') ?? '0');
  await expect(page.locator('[data-edge="review->in_progress"] path.flow-edge-journey')).toHaveCount(1);
  await page.waitForTimeout(1200);
  await snap(page, '36-flow-journey');

  // Agent office: everyone walks in, then the agents talk.
  await page.goto(`/p/${projectId}/office`);
  await expect(page.getByRole('heading', { name: 'In the office · 2' })).toBeVisible();
  await page.waitForTimeout(6000);
  await cursor('add_remark', { item: 'CANDLE-6', kind: 'test_report', body: 'Product page checks out on iPhone and Android.' });
  await claude('log_progress', { ...P, item: 'CANDLE-8', message: 'Writing the cart API tests' });
  await expect(page.getByRole('log', { name: 'Office chatter' })).toContainText('Writing the cart API tests');
  await page.waitForTimeout(2500); // typewriter
  await snap(page, '37-office');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Game menu' })).toBeVisible();
  await snap(page, '38-office-menu');
  await page.keyboard.press('Escape');

  await page.goto(`/p/${projectId}/board?task=${id('CANDLE-5')}`);
  await expect(page.getByRole('dialog').getByText('Changes requested')).toBeVisible();
  await snap(page, '16-task-drawer');

  await page.goto(`/p/${projectId}/board?task=${id('CANDLE-11')}`);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('The agent needs your input')).toBeVisible();
  await drawer.getByPlaceholder(/Answer the agent/).fill('Philippines only for now. Same-day delivery in Metro Manila would be great: please include Lalamove.');
  await snap(page, '17-needs-human');
  await page.keyboard.press('Escape');

  await page.goto(`/p/${projectId}/backlog`);
  await expect(page.getByText('Product backlog')).toBeVisible();
  await snapTall(page, '18-backlog');

  await page.goto(`/p/${projectId}/sprints`);
  await expect(page.getByRole('img', { name: /Burndown/ })).toBeVisible();
  await snap(page, '19-sprints');

  await page.goto(`/p/${projectId}/activity`);
  await expect(page.getByText(/started working on CANDLE-8/).first()).toBeVisible();
  await snap(page, '20-activity');

  await page.goto(`/p/${projectId}/files`);
  await page.getByRole('button', { name: 'app' }).click();
  await page.getByRole('button', { name: 'candles' }).click();
  await page.getByRole('button', { name: 'page.tsx' }).click();
  await expect(page.getByText('CandlesPage')).toBeVisible();
  await snap(page, '21-files');

  await page.goto(`/p/${projectId}/settings`);
  await expect(page.getByRole('heading', { name: 'Board columns' })).toBeVisible();
  await snapTall(page, '22-project-settings');

  // ---------------------------------------------------------------- 5. Workspace, account, admin
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Candle Shop/ }).first()).toBeVisible();
  await snap(page, '23-workspace-projects');
  await page.getByRole('link', { name: 'Members', exact: true }).first().click();
  await expect(page.getByText(MEMBER.email)).toBeVisible();
  await snap(page, '24-workspace-members');

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Access tokens' })).toBeVisible();
  await snapTall(page, '25-account');

  for (const [path, name, check] of [
    ['/admin', '26-admin-overview', 'Agent activity'],
    ['/admin/users', '27-admin-users', MEMBER.email],
    ['/admin/roles', '28-admin-roles', 'Software Architect'],
    ['/admin/settings', '29-admin-settings', 'Agent work enabled'],
    ['/admin/audit', '30-admin-audit', 'setup.completed'],
    ['/admin/system', '31-admin-system', 'Download backup'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByText(check).first()).toBeVisible();
    if (name === '29-admin-settings') await snapTall(page, name);
    else await snap(page, name);
  }

  // ---------------------------------------------------------------- 6. Dark mode, mobile, sign-in
  const state = await page.context().storageState();
  const dark = await browser.newContext({ storageState: state, colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const darkPage = await dark.newPage();
  await darkPage.goto(`/p/${projectId}/board`);
  await expect(darkPage.getByText('Cursor is working as QA Engineer')).toBeVisible();
  await snap(darkPage, '32-board-dark');
  await dark.close();

  const mobile = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`/p/${projectId}/board`);
  await expect(mobilePage.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await snap(mobilePage, '33-mobile-board');
  await mobile.close();

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });
  const loginPage = await anon.newPage();
  await loginPage.goto('/login');
  await expect(loginPage.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await snap(loginPage, '34-login');
  await anon.close();
});
