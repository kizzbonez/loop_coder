import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, api, shot } from './helpers';

test.use({ storageState: ADMIN_STATE });

const guideNav = (page: Page) => page.getByRole('navigation', { name: 'Guide sections' });

/** Loads every (lazy) screenshot in the article and returns their natural widths. */
async function screenshotWidths(page: Page): Promise<number[]> {
  return page.locator('article img').evaluateAll(async (imgs: HTMLImageElement[]) => {
    for (const img of imgs) img.loading = 'eager';
    await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
    return imgs.map((img) => img.naturalWidth);
  });
}

test('the user guide opens from the sidebar on its overview page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'User guide' }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole('heading', { level: 1, name: /Everything you need to run Loop Coder/ })).toBeVisible();

  // Start-here cards, every topic, and the side navigation.
  await expect(page.getByRole('link', { name: /Connect your AI agent/ })).toBeVisible();
  expect(await guideNav(page).getByRole('link').count()).toBeGreaterThanOrEqual(18);
  const hero = page.getByRole('img', { name: 'The Loop Coder board' });
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(800);
  await shot(page, '60-user-guide');

  // Full-text search, then open a result.
  await page.getByRole('searchbox', { name: 'Search the guide' }).last().fill('kill switch');
  await expect(page.getByRole('heading', { name: /results? for “kill switch”/ })).toBeVisible();
  await expect(page.locator('mark', { hasText: /kill switch/i }).first()).toBeVisible();
  const results = page.locator('section', { has: page.getByRole('heading', { name: /results? for/ }) });
  await results.locator('a[href="/guide/17-administration"]').click();
  await expect(page).toHaveURL(/\/guide\/17-administration$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
});

test('section pages have screenshots, callouts, zoom and previous/next navigation', async ({ page }) => {
  await page.goto('/guide');
  await page.getByRole('link', { name: /Connect your AI agent/ }).click();
  await expect(page).toHaveURL(/\/guide\/6-connecting-your-ai-agent$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Connecting your AI agent' })).toBeVisible();
  await expect(guideNav(page).getByRole('link', { name: /Connecting your AI agent/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Warning', { exact: true })).toBeVisible();

  const widths = await screenshotWidths(page);
  expect(widths.length).toBeGreaterThanOrEqual(3);
  for (const w of widths) expect(w).toBeGreaterThan(0);
  await shot(page, '61-user-guide-section');

  await page.getByRole('button', { name: /Enlarge screenshot: Instructions for Claude Code/ }).click();
  await expect(page.getByRole('dialog').locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('link', { name: 'Next: What the agent does' }).click();
  await expect(page).toHaveURL(/\/guide\/7-what-the-agent-does$/);
  await expect(page.getByRole('heading', { level: 1, name: 'What the agent does' })).toBeVisible();
  await page.getByRole('link', { name: 'Previous: Connecting your AI agent' }).click();
  await expect(page).toHaveURL(/\/guide\/6-connecting-your-ai-agent$/);

  // Breadcrumb back to the overview.
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'User guide' }).click();
  await expect(page).toHaveURL(/\/guide$/);
});

test('every section page renders and all its screenshots load', async ({ page }) => {
  await page.goto('/guide');
  await expect(guideNav(page).getByRole('link').nth(17)).toBeAttached();
  const hrefs = await guideNav(page).getByRole('link').evaluateAll((links: HTMLAnchorElement[]) =>
    links.map((a) => a.getAttribute('href')!).filter((h) => h.startsWith('/guide/')),
  );
  expect(hrefs.length).toBeGreaterThanOrEqual(17);
  let images = 0;
  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const widths = await screenshotWidths(page);
    for (const w of widths) expect(w, href).toBeGreaterThan(0);
    images += widths.length;
  }
  expect(images).toBeGreaterThanOrEqual(30);
});

test('the Agent tab links straight to the connection instructions', async ({ page, request }) => {
  const projects = await api<{ items: Array<{ id: string; key: string }> }>(request, 'get', '/projects');
  await page.goto(`/p/${projects.items[0]!.id}/agent`);
  await page.getByRole('link', { name: 'Step-by-step guide' }).click();
  await expect(page).toHaveURL(/\/guide\/6-connecting-your-ai-agent$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Connecting your AI agent' })).toBeVisible();
});

test('old anchor links still open the right section', async ({ page }) => {
  await page.goto('/guide#6-connecting-your-ai-agent');
  await expect(page).toHaveURL(/\/guide\/6-connecting-your-ai-agent$/);
  await page.goto('/guide#step-1-create-a-project-token');
  await expect(page).toHaveURL(/\/guide\/6-connecting-your-ai-agent#step-1-create-a-project-token$/);
  await expect(page.getByRole('heading', { name: 'Step 1: Create a project token' })).toBeInViewport();
});

test('on a phone the guide uses a section picker', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/guide/1-key-ideas');
  await expect(guideNav(page)).toBeHidden();
  await page.getByRole('combobox', { name: 'Jump to section' }).selectOption('13-sprints');
  await expect(page).toHaveURL(/\/guide\/13-sprints$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sprints' })).toBeVisible();
});

test('the guide is also in the user menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Ada Admin/ }).click();
  await page.getByRole('menuitem', { name: 'User guide' }).click();
  await expect(page).toHaveURL(/\/guide$/);
});
