import { expect, test } from '@playwright/test';
import { ADMIN_STATE, api } from './helpers';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

let projectId: string;
let providerId: string;

test.beforeAll(async ({ request }) => {
  const ws = await api<{ items: Array<{ id: string }> }>(request, 'get', '/workspaces');
  projectId = (await api<{ id: string }>(request, 'post', '/projects', { workspaceId: ws.items[0]!.id, name: 'API agents', key: 'APIA', description: 'Agents billed per token' })).id;
  // Not a real key: the e2e stack has no runner, so no model is ever called.
  providerId = (await api<{ id: string }>(request, 'post', '/admin/ai-providers', { name: 'Gemini e2e', preset: 'gemini', apiKey: 'AIza-e2e-not-a-real-key-000000', model: 'gemini-3.8-flash' })).id;
});

test.afterAll(async ({ request }) => {
  await api(request, 'delete', `/admin/ai-providers/${providerId}`);
});

test('an administrator adds an API agent with its provider, model and roles, then starts and stops it', async ({ page }) => {
  await page.goto(`/p/${projectId}/agent`);
  const section = page.getByRole('region', { name: 'API agents' });
  await expect(section.getByText('No API agents on this project yet.')).toBeVisible();

  await section.getByRole('button', { name: 'Add API agent' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Gem builder');
  await expect(dialog.getByLabel('AI provider')).toHaveValue(providerId);
  await expect(dialog.getByLabel('Model')).toHaveAttribute('placeholder', "gemini-3.8-flash (the provider's default)");
  await dialog.getByLabel('Only these roles').check();
  await dialog.getByLabel('Backend Developer').check();
  await dialog.getByLabel('Frontend Developer').check();
  await dialog.getByLabel('Daily token limit').fill('500000');
  await dialog.getByRole('button', { name: 'Add agent' }).click();

  const row = section.getByRole('listitem').filter({ hasText: 'Gem builder' });
  await expect(row.getByText('Stopped')).toBeVisible();
  await expect(row.getByText('Gemini e2e · gemini-3.8-flash')).toBeVisible();
  await expect(row.getByLabel('Roles of Gem builder').getByText('Backend Developer')).toBeVisible();
  await expect(row.getByText('Today: 0 of 500,000 tokens · 0 requests')).toBeVisible();

  await row.getByRole('button', { name: 'Start Gem builder' }).click();
  await expect(row.getByText('Running')).toBeVisible();
  await expect(row.getByText(/Starting…/)).toBeVisible();
  await row.getByRole('button', { name: 'Stop Gem builder' }).click();
  await expect(row.getByText('Stopped', { exact: true })).toBeVisible();

  // Change its roles and model.
  await row.getByRole('button', { name: 'Edit Gem builder' }).click();
  await page.getByRole('dialog').getByLabel('Every role (one agent does everything)').check();
  await page.getByRole('dialog').getByLabel('Model').fill('gemini-3.8-pro');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row.getByLabel('Roles of Gem builder').getByText('Every role')).toBeVisible();
  await expect(row.getByText('Gemini e2e · gemini-3.8-pro')).toBeVisible();

  // Its token is a project token; the page never shows it.
  expect(await page.content()).not.toMatch(/lc_pat_[A-Za-z0-9]/);

  await row.getByRole('button', { name: 'Delete Gem builder' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(section.getByText('No API agents on this project yet.')).toBeVisible();
});

test('the runner endpoints are not reachable from outside', async ({ request }) => {
  const res = await request.get('/llm/runner/agents', { headers: { Authorization: 'Bearer e2e-runner-secret-e2e-runner-secret-0000' } });
  // nginx serves the app for unknown paths; it never forwards /llm to the API.
  expect(res.headers()['content-type'] ?? '').toContain('text/html');
  expect(await res.text()).not.toContain('"items"');
});
