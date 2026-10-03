import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SETUP_CODE = 'E2E-SETUP-CODE-0001';
export const ADMIN = { name: 'Ada Admin', email: 'admin@e2e.test', password: 'correct horse battery staple' };
export const MEMBER = { name: 'Vic Viewer', email: 'viewer@e2e.test', password: 'another long passphrase' };
export const WORKSPACE = 'Acme Labs';
export const ADMIN_STATE = resolve(here, '../.auth/admin.json');
export const SHOTS = resolve(here, '../.screenshots');
mkdirSync(dirname(ADMIN_STATE), { recursive: true });
mkdirSync(SHOTS, { recursive: true });

export const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: false });
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** JSON API call using the page's session cookie. */
export async function api<T = unknown>(request: APIRequestContext, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, data?: unknown): Promise<T> {
  const res = await request[method](`/api${path}`, { headers: CSRF, ...(data !== undefined ? { data } : {}) });
  expect(res.ok(), `${method.toUpperCase()} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

let rpcId = 0;

/** MCP `initialize`, as any client does first; the board then shows the client's name (e.g. "Claude Code"). */
export async function mcpInit(request: APIRequestContext, token: string, clientName = 'claude-code'): Promise<void> {
  const res = await request.post('/mcp', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    data: {
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '2.1.0' } },
    },
  });
  expect(res.status()).toBe(200);
}

/** Call an MCP tool the way an MCP client does (Streamable HTTP, bearer token). */
export async function mcp(request: APIRequestContext, token: string, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await request.post('/mcp', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    data: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  const text = body.result.content.map((c) => c.text).join('\n');
  if (body.result.isError) throw new Error(`${name}: ${text}`);
  return text;
}

export async function createToken(request: APIRequestContext, projectId?: string): Promise<string> {
  const res = await api<{ secret: string }>(request, 'post', '/account/tokens', { name: `e2e ${Date.now()}`, expiresInDays: 7, ...(projectId ? { projectId } : {}) });
  return res.secret;
}
