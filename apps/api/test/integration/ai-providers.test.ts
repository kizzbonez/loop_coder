import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { AiProviderDTO } from '@loop/shared';
import { env } from '../../src/config/env';
import { sqlite } from '../../src/db/client';
import { createUser, freshApp, setupAdmin, type Agent } from '../helpers';

let app: Express;
let admin: Agent;
const KEY = 'sk-ant-api03-THISISATESTKEY-abcdefghijklmnop-WXYZ';
const OPENAI_KEY = 'sk-proj-ANOTHERTESTKEY-1234567890-QRST';
const originalKey = env.LOOP_SECRETS_KEY;

beforeEach(async () => {
  app = freshApp();
  ({ agent: admin } = await setupAdmin(app));
});
afterEach(() => {
  env.LOOP_SECRETS_KEY = originalKey;
  env.EGRESS_ALLOWLIST_PATH = undefined;
  vi.unstubAllGlobals();
});

const create = async (body: Record<string, unknown>, status = 201) => (await admin.post('/api/admin/ai-providers').send(body).expect(status)).body;
const anthropic = () => create({ name: 'Claude', preset: 'anthropic', apiKey: KEY }) as Promise<AiProviderDTO>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AI providers: storing keys', () => {
  it('is for administrators only', async () => {
    const { agent } = await createUser(app, admin, 'member@example.com');
    await agent.get('/api/admin/ai-providers').expect(403);
    await agent.post('/api/admin/ai-providers').send({ name: 'x', preset: 'anthropic', apiKey: KEY }).expect(403);
  });

  it('seals the key: never returned, never stored or audited in the clear', async () => {
    const created = await anthropic();
    expect(created).toMatchObject({ name: 'Claude', preset: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', enabled: true, key: { hint: 'WXYZ', status: 'ok' }, lastTest: null });
    const list = (await admin.get('/api/admin/ai-providers').expect(200)).body;
    expect(list).toMatchObject({ secretsConfigured: true, allowedHosts: ['api.anthropic.com'] });
    expect(JSON.stringify(list)).not.toContain(KEY);
    const row = sqlite.prepare('SELECT api_key_sealed AS sealed, api_key_hint AS hint FROM ai_providers').get() as { sealed: string; hint: string };
    expect(row.sealed).toMatch(/^v1:/);
    expect(row.sealed).not.toContain('THISISATESTKEY');
    const audit = (await admin.get('/api/admin/audit?limit=200').expect(200)).body;
    expect(JSON.stringify(audit)).not.toContain(KEY);
    expect(audit.items.map((a: { action: string }) => a.action)).toContain('ai_provider.created');
  });

  it('refuses to store keys until LOOP_SECRETS_KEY is set', async () => {
    env.LOOP_SECRETS_KEY = undefined;
    expect((await admin.get('/api/admin/ai-providers').expect(200)).body.secretsConfigured).toBe(false);
    const res = await admin.post('/api/admin/ai-providers').send({ name: 'Claude', preset: 'anthropic', apiKey: KEY }).expect(409);
    expect(res.body.error.message).toMatch(/LOOP_SECRETS_KEY/);
  });

  it('marks keys saved with another master key as locked, and will not use them', async () => {
    const created = await anthropic();
    env.LOOP_SECRETS_KEY = 'f'.repeat(64);
    const item = (await admin.get('/api/admin/ai-providers').expect(200)).body.items[0];
    expect(item.key.status).toBe('locked');
    const res = await admin.post(`/api/admin/ai-providers/${created.id}/test`).expect(409);
    expect(res.body.error.message).toMatch(/different LOOP_SECRETS_KEY/);
  });

  it('validates addresses, models, keys and names', async () => {
    const base = { name: 'P', preset: 'openai', apiKey: OPENAI_KEY };
    for (const baseUrl of ['http://api.openai.com/v1', 'https://user:pass@api.openai.com/v1', 'https://10.0.0.5/v1', 'https://api.openai.com:8443/v1', 'https://api.openai.com/v1?x=1', 'ftp://api.openai.com', 'not a url']) {
      await create({ ...base, baseUrl }, 400);
    }
    await create({ ...base, preset: 'custom' }, 400); // custom needs an address
    await create({ ...base, model: 'gpt x; rm -rf' }, 400);
    await create({ ...base, apiKey: 'has spaces in it' }, 400);
    await create({ ...base, apiKey: 'short' }, 400);
    await create({ ...base, preset: 'unknown' }, 400);
    const ok = await create({ ...base, baseUrl: 'https://api.openai.com/v1/' });
    expect(ok.baseUrl).toBe('https://api.openai.com/v1');
    await create(base, 409); // same name
  });

  it('updates, replaces the key, disables and deletes, keeping the gateway allow list in step', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'egress-'));
    env.EGRESS_ALLOWLIST_PATH = join(dir, 'allowlist.json');
    const hosts = () => JSON.parse(readFileSync(env.EGRESS_ALLOWLIST_PATH!, 'utf8')).hosts;
    const claude = await anthropic();
    const gemini = await create({ name: 'Gemini', preset: 'gemini', apiKey: 'AIzaSyTESTKEY-1234567890-gem1' });
    expect(hosts()).toEqual(['api.anthropic.com', 'generativelanguage.googleapis.com']);

    const replaced = (await admin.patch(`/api/admin/ai-providers/${claude.id}`).send({ apiKey: 'sk-ant-api03-REPLACEDKEY-0000000000-NEW1', model: 'claude-sonnet-5-5' }).expect(200)).body;
    expect(replaced).toMatchObject({ model: 'claude-sonnet-5-5', key: { hint: 'NEW1', status: 'ok' } });
    await admin.patch(`/api/admin/ai-providers/${gemini.id}`).send({ enabled: false }).expect(200);
    expect(hosts()).toEqual(['api.anthropic.com']);
    await admin.patch(`/api/admin/ai-providers/${claude.id}`).send({ name: 'Gemini' }).expect(409);
    await admin.delete(`/api/admin/ai-providers/${claude.id}`).expect(204);
    expect(hosts()).toEqual([]);
    await admin.delete(`/api/admin/ai-providers/${claude.id}`).expect(404);
    const actions = (await admin.get('/api/admin/audit?limit=200').expect(200)).body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['ai_provider.updated', 'ai_provider.deleted']));
  });
});

describe('AI providers: Test connection', () => {
  it('lists Anthropic models through the official SDK with the stored key', async () => {
    const claude = await anthropic();
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }, { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'a', last_id: 'b' }));
    vi.stubGlobal('fetch', fetch);
    const result = (await admin.post(`/api/admin/ai-providers/${claude.id}/test`).expect(200)).body;
    expect(result).toMatchObject({ ok: true, message: 'Connected. 2 models available.', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] });
    expect(result.provider.lastTest).toMatchObject({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(new Headers(init?.headers).get('x-api-key')).toBe(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('explains a rejected Anthropic key without echoing anything the provider said', async () => {
    const claude = await anthropic();
    vi.stubGlobal('fetch', vi.fn(async () => json({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401)));
    const result = (await admin.post(`/api/admin/ai-providers/${claude.id}/test`).expect(200)).body;
    expect(result).toMatchObject({ ok: false, message: 'The provider rejected the API key (401). Check it and save it again.', models: [] });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('lists models of OpenAI-compatible providers with a bearer token', async () => {
    const openai = await create({ name: 'OpenAI', preset: 'openai', apiKey: OPENAI_KEY });
    const fetch = vi.fn(async () => json({ object: 'list', data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 42 }] }));
    vi.stubGlobal('fetch', fetch);
    const result = (await admin.post(`/api/admin/ai-providers/${openai.id}/test`).expect(200)).body;
    expect(result).toMatchObject({ ok: true, models: ['model-a', 'model-b'] });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${OPENAI_KEY}`);
    expect(init.redirect).toBe('error');
    // The remembered models feed the model picker.
    expect((await admin.get('/api/admin/ai-providers').expect(200)).body.items[0].models).toEqual(['model-a', 'model-b']);
  });

  it('says plainly when a provider cannot be reached or errors', async () => {
    const openai = await create({ name: 'OpenAI', preset: 'openai', apiKey: OPENAI_KEY });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await admin.post(`/api/admin/ai-providers/${openai.id}/test`).expect(200)).body.message).toMatch(/Could not reach the provider/);
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 404)));
    expect((await admin.post(`/api/admin/ai-providers/${openai.id}/test`).expect(200)).body.message).toMatch(/404: check the base URL/);
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)));
    expect((await admin.post(`/api/admin/ai-providers/${openai.id}/test`).expect(200)).body.message).toMatch(/rate-limited/);
  });
});
