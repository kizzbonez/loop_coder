import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { getSetupCodeForTests } from '../../src/modules/auth/auth.service';
import { client, freshApp, PASSWORD, setupAdmin } from '../helpers';

let app: Express;
beforeEach(() => {
  app = freshApp();
});

const body = (overrides: Record<string, unknown> = {}) => ({
  setupCode: getSetupCodeForTests(),
  name: 'Ada Admin',
  email: 'admin@example.com',
  password: PASSWORD,
  appName: 'Team Board',
  workspaceName: 'Acme Labs',
  ...overrides,
});

describe('first-run onboarding wizard', () => {
  it('reports that setup is required on a fresh install', async () => {
    const res = await request(app).get('/api/config').expect(200);
    expect(res.body).toMatchObject({ setupRequired: true, registrationEnabled: false, passwordMinLength: 12 });
    expect(res.body.version.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects a wrong setup code', async () => {
    const res = await client(app).post('/api/setup').send(body({ setupCode: 'WRONG-CODE' })).expect(403);
    expect(res.body.error.message).toMatch(/setup code/i);
  });

  it('accepts the setup code case-insensitively with surrounding whitespace', async () => {
    await client(app)
      .post('/api/setup')
      .send(body({ setupCode: `  ${getSetupCodeForTests().toLowerCase()} ` }))
      .expect(201);
  });

  it('enforces the password policy', async () => {
    const res = await client(app).post('/api/setup').send(body({ password: 'short' })).expect(400);
    expect(res.body.error.details[0].path).toBe('password');
  });

  it('validates the email address', async () => {
    await client(app).post('/api/setup').send(body({ email: 'nope' })).expect(400);
  });

  it('creates the admin, the first workspace and signs in', async () => {
    const agent = client(app);
    const res = await agent.post('/api/setup').send(body()).expect(201);
    expect(res.body.user).toMatchObject({ email: 'admin@example.com', role: 'admin', status: 'active' });
    expect(res.headers['set-cookie']?.[0]).toMatch(/lc_session=.*HttpOnly.*SameSite=Strict/i);

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.role).toBe('admin');

    const workspaces = await agent.get('/api/workspaces').expect(200);
    expect(workspaces.body.items).toHaveLength(1);
    expect(workspaces.body.items[0]).toMatchObject({ name: 'Acme Labs', slug: 'acme-labs', myAccess: 'admin' });

    const config = await request(app).get('/api/config').expect(200);
    expect(config.body).toMatchObject({ setupRequired: false, appName: 'Team Board' });
  });

  it('cannot run twice, and the setup code is single-use', async () => {
    const code = getSetupCodeForTests();
    await client(app).post('/api/setup').send(body()).expect(201);
    expect(getSetupCodeForTests()).not.toBe(code);
    const again = await client(app)
      .post('/api/setup')
      .send(body({ setupCode: getSetupCodeForTests(), email: 'other@example.com' }))
      .expect(409);
    expect(again.body.error.code).toBe('conflict');
  });

  it('requires the CSRF header', async () => {
    await request(app).post('/api/setup').send(body()).expect(403);
  });

  it('blocks registration until setup is done', async () => {
    const res = await client(app)
      .post('/api/auth/register')
      .send({ email: 'x@example.com', name: 'X', password: PASSWORD })
      .expect((r) => expect([403, 409]).toContain(r.status));
    expect(res.body.error).toBeDefined();
  });

  it('records the setup in the audit log', async () => {
    const { agent } = await setupAdmin(app);
    const audit = await agent.get('/api/admin/audit?action=setup').expect(200);
    expect(audit.body.items.map((i: { action: string }) => i.action)).toContain('setup.completed');
  });

  it('exposes health and version without authentication', async () => {
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok' });
    expect(health.headers['cache-control']).toBe('no-store');
    await request(app).get('/api/version').expect(200);
  });
});
