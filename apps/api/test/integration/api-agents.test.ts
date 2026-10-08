import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AiProviderDTO, ApiAgentDTO } from '@loop/shared';
import { env } from '../../src/config/env';
import { sqlite } from '../../src/db/client';
import { createProject, createUser, freshApp, mcpClient, setupAdmin, type Agent } from '../helpers';

let app: Express;
let admin: Agent;
let projectId: string;
const RUNNER = 'runner-secret-for-tests-0123456789abcdef';
const CLAUDE_KEY = 'sk-ant-api03-THISISATESTKEY-abcdefghijklmnop-WXYZ';
const GEMINI_KEY = 'AIzaSyTESTKEY-1234567890-gem1';

beforeEach(async () => {
  app = freshApp();
  const setup = await setupAdmin(app);
  admin = setup.agent;
  projectId = (await createProject(admin, setup.workspaceId, 'SHOP')).id;
  env.LOOP_RUNNER_SECRET = RUNNER;
});
afterEach(() => {
  env.LOOP_RUNNER_SECRET = undefined;
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const provider = async (preset: 'anthropic' | 'gemini' = 'anthropic'): Promise<AiProviderDTO> =>
  (await admin.post('/api/admin/ai-providers').send(preset === 'anthropic' ? { name: 'Claude', preset, apiKey: CLAUDE_KEY } : { name: 'Gemini', preset, apiKey: GEMINI_KEY, model: 'gemini-3.8-flash' }).expect(201)).body;
const createAgent = async (body: Record<string, unknown>, status = 201) => (await admin.post('/api/admin/api-agents').send({ projectId, ...body }).expect(status)).body;
const runner = () => request(app).get('/llm/runner/agents').set('Authorization', `Bearer ${RUNNER}`);
const tokenRow = (id: string) => sqlite.prepare('SELECT project_id AS projectId, role_keys AS roleKeys, revoked_at AS revokedAt FROM api_tokens WHERE id = ?').get(id) as { projectId: string; roleKeys: string | null; revokedAt: number | null };
const agentRow = (id: string) => sqlite.prepare('SELECT token_id AS tokenId, token_sealed AS sealed FROM api_agents WHERE id = ?').get(id) as { tokenId: string; sealed: string };

/** Start an agent and fetch what the runner gets for it (its token in the clear). */
async function started(agent: ApiAgentDTO) {
  await admin.post(`/api/admin/api-agents/${agent.id}/start`).expect(200);
  const items = (await runner().expect(200)).body.items as Array<{ id: string; token: string; model: string; providerKind: string; workspacePath: string; git: { email: string } }>;
  return items.find((i) => i.id === agent.id)!;
}

describe('API agents: configuration', () => {
  it('is for administrators only', async () => {
    const { agent } = await createUser(app, admin, 'member@example.com');
    await agent.get(`/api/admin/api-agents?projectId=${projectId}`).expect(403);
    await agent.post('/api/admin/api-agents').send({ projectId, name: 'Bot', providerId: (await provider()).id }).expect(403);
  });

  it('creates an agent with its own project token for the roles it plays; the token is sealed, never shown', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Gemma builder', providerId: claude.id, roleKeys: ['backend_developer'] });
    expect(agent).toMatchObject({ name: 'Gemma builder', providerName: 'Claude', providerKind: 'anthropic', model: 'claude-opus-5-5', roleKeys: ['backend_developer'], state: 'stopped', dailyTokenLimit: 2_000_000, maxTurnsPerStep: 60, canRunCommands: true, usageToday: { inputTokens: 0, outputTokens: 0, requests: 0 } });
    const row = agentRow(agent.id);
    expect(row.sealed).toMatch(/^v1:/);
    expect(row.sealed).not.toMatch(/loop_/);
    expect(tokenRow(row.tokenId)).toMatchObject({ projectId, roleKeys: '["backend_developer"]', revokedAt: null });
    const list = (await admin.get(`/api/admin/api-agents?projectId=${projectId}`).expect(200)).body;
    expect(list).toMatchObject({ runnerConfigured: true, items: [{ id: agent.id }] });
    expect(JSON.stringify(list)).not.toMatch(/loop_[A-Za-z0-9]/);
    const actions = (await admin.get('/api/admin/audit?limit=50').expect(200)).body.items.map((a: { action: string }) => a.action);
    expect(actions).toContain('api_agent.created');
  });

  it('validates names, providers, roles and limits', async () => {
    const claude = await provider();
    await createAgent({ name: 'Bot', providerId: claude.id });
    await createAgent({ name: 'Bot', providerId: claude.id }, 409);
    await createAgent({ name: '<script>', providerId: claude.id }, 400);
    await createAgent({ name: 'X', providerId: '00000000-0000-4000-8000-000000000000' }, 400);
    await createAgent({ name: 'Y', providerId: claude.id, roleKeys: ['no-such-role'] }, 400);
    await createAgent({ name: 'Z', providerId: claude.id, dailyTokenLimit: 5 }, 400);
    await createAgent({ name: 'Z', providerId: claude.id, model: 'bad model; rm' }, 400);
  });

  it('changes roles on its token, and revokes the token when deleted', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Bot', providerId: claude.id });
    const { tokenId } = agentRow(agent.id);
    expect(tokenRow(tokenId).roleKeys).toBeNull();
    const updated = (await admin.patch(`/api/admin/api-agents/${agent.id}`).send({ roleKeys: ['qa_engineer'], dailyTokenLimit: 50_000 }).expect(200)).body;
    expect(updated).toMatchObject({ roleKeys: ['qa_engineer'], dailyTokenLimit: 50_000 });
    expect(tokenRow(tokenId).roleKeys).toBe('["qa_engineer"]');
    await admin.delete(`/api/admin/api-agents/${agent.id}`).expect(204);
    expect(tokenRow(tokenId).revokedAt).not.toBeNull();
    await admin.delete(`/api/admin/api-agents/${agent.id}`).expect(404);
  });

  it('only starts when the runner is set up and its provider is usable', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Bot', providerId: claude.id });
    env.LOOP_RUNNER_SECRET = undefined;
    expect((await admin.post(`/api/admin/api-agents/${agent.id}/start`).expect(409)).body.error.message).toMatch(/secrets-key/);
    env.LOOP_RUNNER_SECRET = RUNNER;
    await admin.patch(`/api/admin/ai-providers/${claude.id}`).send({ enabled: false }).expect(200);
    await admin.post(`/api/admin/api-agents/${agent.id}/start`).expect(409);
    await admin.patch(`/api/admin/ai-providers/${claude.id}`).send({ enabled: true }).expect(200);
    expect((await admin.post(`/api/admin/api-agents/${agent.id}/start`).expect(200)).body).toMatchObject({ state: 'running', status: { activity: 'Starting…' } });
    expect((await admin.post(`/api/admin/api-agents/${agent.id}/stop`).expect(200)).body).toMatchObject({ state: 'stopped' });
  });
});

describe('API agents: the runner', () => {
  it('needs the runner secret, and is never reachable through the web proxy', async () => {
    await request(app).get('/llm/runner/agents').expect(401);
    await request(app).get('/llm/runner/agents').set('Authorization', 'Bearer wrong-secret-wrong-secret-wrong-secret').expect(401);
    await runner().set('X-Forwarded-For', '203.0.113.9').expect(404);
    env.LOOP_RUNNER_SECRET = undefined;
    await request(app).get('/llm/runner/agents').set('Authorization', `Bearer ${RUNNER}`).expect(503);
  });

  it('lists running agents with their token, which works on the MCP server under the agent’s name', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Gemma', providerId: claude.id, roleKeys: ['backend_developer'] });
    expect((await runner().expect(200)).body.items).toEqual([]);
    const job = await started(agent);
    expect(job).toMatchObject({ model: 'claude-opus-5-5', providerKind: 'anthropic', workspacePath: 'acme/shop', git: { email: 'admin@example.com' } });
    const mcp = mcpClient(app, job.token);
    await mcp.initialize('loop-api-agent/Gemma');
    expect(await mcp.ok('get_next_work', { project: 'SHOP' })).toMatch(/STATUS/);
    const agents = (await admin.get(`/api/projects/${projectId}/agent-sessions`).expect(200)).body;
    expect(JSON.stringify(agents)).toContain('Gemma');
  });

  it('replaces a revoked token on the next listing', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Bot', providerId: claude.id });
    const first = await started(agent);
    sqlite.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(Date.now(), agentRow(agent.id).tokenId);
    const second = (await runner().expect(200)).body.items[0];
    expect(second.token).not.toBe(first.token);
    expect((await mcpClient(app, second.token).initialize()).status).toBe(200);
    expect(tokenRow(agentRow(agent.id).tokenId).revokedAt).toBeNull();
  });

  it('leaves out agents whose creator is no longer an administrator, saying why', async () => {
    const claude = await provider();
    const { agent: other, userId } = await createUser(app, admin, 'second-admin@example.com', 'admin');
    const agent: ApiAgentDTO = (await other.post('/api/admin/api-agents').send({ projectId, name: 'Theirs', providerId: claude.id }).expect(201)).body;
    await other.post(`/api/admin/api-agents/${agent.id}/start`).expect(200);
    expect((await runner().expect(200)).body.items).toHaveLength(1);
    await admin.patch(`/api/admin/users/${userId}`).send({ role: 'user' }).expect(200);
    expect((await runner().expect(200)).body.items).toEqual([]);
    const dto = (await admin.get(`/api/admin/api-agents?projectId=${projectId}`).expect(200)).body.items[0];
    expect(dto.status.error).toMatch(/no longer an active administrator/);
  });

  it('records what the runner reports', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Bot', providerId: claude.id });
    await started(agent);
    await request(app).post(`/llm/runner/agents/${agent.id}/status`).send({ activity: 'Working on SHOP-1' }).expect(401);
    await request(app).post(`/llm/runner/agents/${agent.id}/status`).set('Authorization', `Bearer ${RUNNER}`).send({ activity: 'Working on SHOP-1' }).expect(204);
    let dto = (await admin.get(`/api/admin/api-agents?projectId=${projectId}`).expect(200)).body.items[0];
    expect(dto.status).toMatchObject({ activity: 'Working on SHOP-1', error: null });
    await request(app).post(`/llm/runner/agents/${agent.id}/status`).set('Authorization', `Bearer ${RUNNER}`).send({ error: 'Daily token limit reached', stopped: true }).expect(204);
    dto = (await admin.get(`/api/admin/api-agents?projectId=${projectId}`).expect(200)).body.items[0];
    expect(dto).toMatchObject({ state: 'stopped', status: { error: 'Daily token limit reached' } });
  });
});

describe('API agents: the model relay', () => {
  it('forwards Anthropic requests with the stored key and the agent’s model, and counts tokens', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Bot', providerId: claude.id });
    const { token } = await started(agent);
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn', usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 7 } }));
    vi.stubGlobal('fetch', fetch);
    const res = await request(app)
      .post(`/llm/agents/${agent.id}/v1/messages`)
      .set('x-api-key', token)
      .set('anthropic-version', '2023-06-01')
      .set('anthropic-beta', 'server-side-fallback-2026-07-01')
      .send({ model: 'claude-fable-5-1', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] })
      .expect(200);
    expect(res.body.content[0].text).toBe('Hi');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe(CLAUDE_KEY);
    expect(headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(JSON.parse(String(init?.body)).model).toBe('claude-opus-5-5');
    const dto = (await admin.get(`/api/admin/api-agents?projectId=${projectId}`).expect(200)).body.items[0];
    expect(dto.usageToday).toEqual({ inputTokens: 120, outputTokens: 7, requests: 1 });
    expect(JSON.stringify(res.body)).not.toContain(CLAUDE_KEY);
  });

  it('forwards OpenAI-compatible requests (Gemini) with a bearer key', async () => {
    const gemini = await provider('gemini');
    const agent: ApiAgentDTO = await createAgent({ name: 'Gem', providerId: gemini.id, roleKeys: ['qa_engineer'] });
    const { token, providerKind, model } = await started(agent);
    expect({ providerKind, model }).toEqual({ providerKind: 'openai_compatible', model: 'gemini-3.8-flash' });
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
    vi.stubGlobal('fetch', fetch);
    await request(app).post(`/llm/agents/${agent.id}/chat/completions`).set('Authorization', `Bearer ${token}`).send({ messages: [{ role: 'user', content: 'Hi' }] }).expect(200);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${GEMINI_KEY}`);
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body)).model).toBe('gemini-3.8-flash');
    // Wrong dialect for this provider.
    await request(app).post(`/llm/agents/${agent.id}/v1/messages`).set('x-api-key', token).send({ messages: [] }).expect(400);
  });

  it('refuses other tokens, stopped agents, streaming and spent budgets', async () => {
    const claude = await provider();
    const bot: ApiAgentDTO = await createAgent({ name: 'Bot', providerId: claude.id, dailyTokenLimit: 10_000 });
    const other: ApiAgentDTO = await createAgent({ name: 'Other', providerId: claude.id });
    const { token } = await started(bot);
    const otherJob = await started(other);
    const fetch = vi.fn(async () => json({ content: [], usage: { input_tokens: 9_000, output_tokens: 1_500 } }));
    vi.stubGlobal('fetch', fetch);
    const post = (t: string) => request(app).post(`/llm/agents/${bot.id}/v1/messages`).set('x-api-key', t);
    await post(otherJob.token).send({ messages: [] }).expect(401);
    await post('loop_not-a-real-token').send({ messages: [] }).expect(401);
    await post(token).send({ messages: [], stream: true }).expect(400);
    await post(token).send({ messages: [] }).expect(200);
    const spent = await post(token).send({ messages: [] }).expect(402);
    expect(spent.body.error.type).toBe('budget_exhausted');
    expect(fetch).toHaveBeenCalledTimes(1);
    await admin.post(`/api/admin/api-agents/${other.id}/stop`).expect(200);
    await request(app).post(`/llm/agents/${other.id}/v1/messages`).set('x-api-key', otherJob.token).send({ messages: [] }).expect(409);
  });

  it('says so when the provider cannot be reached', async () => {
    const claude = await provider();
    const agent: ApiAgentDTO = await createAgent({ name: 'Bot', providerId: claude.id });
    const { token } = await started(agent);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res = await request(app).post(`/llm/agents/${agent.id}/v1/messages`).set('x-api-key', token).send({ messages: [] }).expect(502);
    expect(res.body.error.message).toBe('The AI provider could not be reached');
  });
});
