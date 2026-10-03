import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

// Configure a public domain plus localhost before the app modules load (as in a Cloudflare Tunnel deployment).
process.env.APP_ORIGIN = 'https://loop-code.example.com, http://localhost:8080';
const { createToken, freshApp, setupAdmin } = await import('../helpers');
const { isAllowedOrigin, publicOrigin } = await import('../../src/config/env');

type App = ReturnType<typeof freshApp>;
let app: App;
let agent: Awaited<ReturnType<typeof setupAdmin>>['agent'];

beforeEach(async () => {
  app = freshApp();
  ({ agent } = await setupAdmin(app));
});

describe('APP_ORIGIN allow-list', () => {
  it('parses a comma-separated list and uses the first entry as the public URL', () => {
    expect(publicOrigin).toBe('https://loop-code.example.com');
    expect(isAllowedOrigin('https://loop-code.example.com', 'anything')).toBe(true);
    expect(isAllowedOrigin('http://localhost:8080', 'anything')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('https://evil.example', 'loop-code.example.com')).toBe(false);
    expect(isAllowedOrigin('not a url', 'x')).toBe(false);
  });

  it('accepts browser requests from every configured origin', async () => {
    await agent.post('/api/workspaces').set('Origin', 'https://loop-code.example.com').send({ name: 'Public' }).expect(201);
    await agent.post('/api/workspaces').set('Origin', 'http://localhost:8080').send({ name: 'Local' }).expect(201);
  });

  it('rejects other origins even when they match the Host header', async () => {
    await agent.post('/api/workspaces').set('Host', 'attacker.test').set('Origin', 'http://attacker.test').send({ name: 'X' }).expect(403);
  });

  it('applies the same allow-list to the MCP endpoint', async () => {
    const token = await createToken(agent);
    const call = (origin: string) =>
      request(app)
        .post('/mcp')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((await call('https://loop-code.example.com')).status).toBe(200);
    expect((await call('https://evil.example')).status).toBe(403);
  });
});
