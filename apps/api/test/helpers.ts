import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { bootstrap } from '../src/bootstrap';
import { sqlite } from '../src/db/client';
import { getSetupCodeForTests } from '../src/modules/auth/auth.service';
import { seedDefaultRoles } from '../src/modules/roles/roles.service';
import { ensureDefaultSettings, resetSettingsCache } from '../src/modules/settings/settings.service';

export const PASSWORD = 'correct horse battery staple';
export const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

let migrated = false;

/** Fresh application on a clean database (all rows removed, defaults re-seeded). */
export function freshApp(options: Parameters<typeof createApp>[0] = {}): Express {
  if (!migrated) {
    bootstrap();
    migrated = true;
  }
  resetDatabase();
  return createApp({ log: false, ...options });
}

export function resetDatabase(): void {
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'")
    .all() as Array<{ name: string }>;
  sqlite.pragma('foreign_keys = OFF');
  for (const { name } of tables) sqlite.prepare(`delete from "${name}"`).run();
  sqlite.pragma('foreign_keys = ON');
  resetSettingsCache();
  ensureDefaultSettings();
  seedDefaultRoles();
}

export type Agent = ReturnType<typeof request.agent>;

/** A cookie-keeping client that sends the CSRF header on every request. */
export function client(app: Express): Agent {
  return request.agent(app).set(CSRF);
}

export async function setupAdmin(
  app: Express,
  overrides: Partial<{ email: string; name: string; workspaceName: string; registrationEnabled: boolean }> = {},
): Promise<{ agent: Agent; userId: string; workspaceId: string }> {
  const agent = client(app);
  const res = await agent
    .post('/api/setup')
    .send({
      setupCode: getSetupCodeForTests(),
      name: overrides.name ?? 'Ada Admin',
      email: overrides.email ?? 'admin@example.com',
      password: PASSWORD,
      workspaceName: overrides.workspaceName ?? 'Acme',
      registrationEnabled: overrides.registrationEnabled ?? false,
    })
    .expect(201);
  return { agent, userId: res.body.user.id, workspaceId: res.body.workspaceId };
}

export async function createUser(
  app: Express,
  admin: Agent,
  email: string,
  role: 'admin' | 'user' = 'user',
): Promise<{ agent: Agent; userId: string }> {
  const res = await admin
    .post('/api/admin/users')
    .send({ email, name: email.split('@')[0], password: PASSWORD, role })
    .expect(201);
  const agent = client(app);
  await agent.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { agent, userId: res.body.id };
}

export async function addMember(
  owner: Agent,
  workspaceId: string,
  email: string,
  role: 'owner' | 'editor' | 'viewer',
): Promise<void> {
  await owner.post(`/api/workspaces/${workspaceId}/members`).send({ email, role }).expect(201);
}

export async function createProject(
  agent: Agent,
  workspaceId: string,
  key = 'SHOP',
  description = 'Build a tiny todo app',
): Promise<{ id: string; key: string; columns: Array<{ id: string; kind: string; name: string; agentRoleId: string | null }> }> {
  const res = await agent
    .post('/api/projects')
    .send({ workspaceId, name: `${key} project`, key, description })
    .expect(201);
  return res.body;
}

export async function createToken(
  agent: Agent,
  scope: { projectId?: string; workspaceId?: string } = {},
): Promise<string> {
  const res = await agent
    .post('/api/account/tokens')
    .send({ name: 'test', expiresInDays: 30, ...scope })
    .expect(201);
  return res.body.secret as string;
}

export function columnId(project: { columns: Array<{ id: string; kind: string }> }, kind: string): string {
  const col = project.columns.find((c) => c.kind === kind);
  if (!col) throw new Error(`no ${kind} column`);
  return col.id;
}

// ---------------------------------------------------------------------------
// MCP (JSON-RPC over Streamable HTTP)
// ---------------------------------------------------------------------------

export interface ToolResult {
  text: string;
  isError: boolean;
}

export function mcpClient(app: Express, token: string) {
  let id = 0;
  const rpc = (method: string, params?: unknown) =>
    request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-protocol-version', '2025-06-18')
      .send({ jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) });

  return {
    rpc,
    async initialize(clientName = 'claude-code') {
      return rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: clientName, version: '2.1.0' },
      });
    },
    async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      const res = await rpc('tools/call', { name, arguments: args });
      if (res.status !== 200) throw new Error(`MCP HTTP ${res.status}: ${JSON.stringify(res.body)}`);
      if (res.body.error) throw new Error(`MCP error: ${JSON.stringify(res.body.error)}`);
      const result = res.body.result as { content: Array<{ text: string }>; isError?: boolean };
      return { text: result.content.map((c) => c.text).join('\n'), isError: Boolean(result.isError) };
    },
    /** Call a tool and fail the test if it reports an error. */
    async ok(name: string, args: Record<string, unknown> = {}): Promise<string> {
      const r = await this.call(name, args);
      if (r.isError) throw new Error(`${name} failed: ${r.text}`);
      return r.text;
    },
  };
}

export type McpClient = ReturnType<typeof mcpClient>;
