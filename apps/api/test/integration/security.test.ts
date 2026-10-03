import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { client, createUser, freshApp, PASSWORD, setupAdmin } from '../helpers';

describe('HTTP hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const app = freshApp();
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('marks API responses as non-cacheable', async () => {
    const app = freshApp();
    const res = await request(app).get('/api/config').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns JSON 404s for unknown endpoints', async () => {
    const app = freshApp();
    const res = await request(app).get('/api/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('rejects malformed JSON with 400', async () => {
    const app = freshApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(res.body.error.message).toMatch(/Malformed JSON/);
  });

  it('rejects oversized bodies with 413', async () => {
    const app = freshApp();
    await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'a@b.co', password: 'x'.repeat(2 * 1024 * 1024) })
      .expect(413);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const app = freshApp();
    const { agent } = await setupAdmin(app);
    const res = await agent.post('/api/workspaces').unset('X-Requested-With').send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/);
  });

  it('rejects cross-origin requests even with the header', async () => {
    const app = freshApp();
    const { agent } = await setupAdmin(app);
    await agent.post('/api/workspaces').set('Origin', 'https://evil.example').send({ name: 'X' }).expect(403);
  });

  it('allows same-origin requests', async () => {
    const app = freshApp();
    const { agent } = await setupAdmin(app);
    const res = await agent.post('/api/workspaces').set('Host', 'board.local').set('Origin', 'http://board.local').send({ name: 'X' });
    expect(res.status).toBe(201);
  });

  it('does not require the header for safe methods', async () => {
    const app = freshApp();
    await request(app).get('/api/config').expect(200);
  });
});

describe('authorisation boundaries', () => {
  it('keeps the admin console admin-only', async () => {
    const app = freshApp();
    const { agent: admin } = await setupAdmin(app);
    const { agent: user } = await createUser(app, admin, 'user@example.com');
    for (const path of ['/api/admin/users', '/api/admin/stats', '/api/admin/settings', '/api/admin/audit', '/api/admin/backup']) {
      await user.get(path).expect(403);
      await request(app).get(path).expect(401);
    }
  });

  it('treats malformed ids as not found', async () => {
    const app = freshApp();
    const { agent } = await setupAdmin(app);
    await agent.get('/api/projects/not-a-uuid').expect(404);
    await agent.get("/api/tasks/1' OR '1'='1").expect(404);
  });

  it('does not reveal whether another user\'s workspace exists', async () => {
    const app = freshApp();
    const { agent: admin } = await setupAdmin(app);
    const { agent: alice } = await createUser(app, admin, 'alice@example.com');
    const { agent: bob } = await createUser(app, admin, 'bob@example.com');
    const ws = await alice.post('/api/workspaces').send({ name: 'Private' }).expect(201);
    const missing = await bob.get('/api/workspaces/6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e6f').expect(404);
    const hidden = await bob.get(`/api/workspaces/${ws.body.id}`).expect(404);
    // Identical responses: an outsider cannot tell "exists but private" from "does not exist".
    expect(hidden.body).toEqual(missing.body);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts per IP', async () => {
    const app = freshApp({ rateLimit: { enabled: true } });
    await setupAdmin(app);
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await client(app).post('/api/auth/login').send({ email: `x${i}@example.com`, password: PASSWORD });
      if (res.status === 429) {
        limited = true;
        expect(res.body.error.code).toBe('rate_limited');
        expect(res.headers['ratelimit-policy'] ?? res.headers['ratelimit']).toBeDefined();
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
