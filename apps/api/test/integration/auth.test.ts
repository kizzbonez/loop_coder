import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { client, createUser, freshApp, PASSWORD, setupAdmin, type Agent } from '../helpers';

let app: Express;
let admin: Agent;

beforeEach(async () => {
  app = freshApp();
  ({ agent: admin } = await setupAdmin(app));
});

describe('login', () => {
  it('signs in with valid credentials and sets a hardened session cookie', async () => {
    const agent = client(app);
    const res = await agent.post('/api/auth/login').send({ email: 'ADMIN@example.com ', password: PASSWORD }).expect(200);
    expect(res.body.user.email).toBe('admin@example.com');
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
    await agent.get('/api/auth/me').expect(200);
  });

  it('marks the cookie Secure when the request came over HTTPS through the proxy', async () => {
    const res = await client(app)
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: 'admin@example.com', password: PASSWORD })
      .expect(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/Secure/);
  });

  it('uses the same generic error for unknown users and wrong passwords', async () => {
    const unknown = await client(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: PASSWORD }).expect(401);
    const wrong = await client(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'wrong password 123' }).expect(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks the account after too many failures and an admin can unlock it', async () => {
    const { userId } = await createUser(app, admin, 'bob@example.com');
    for (let i = 0; i < 5; i++) {
      await client(app).post('/api/auth/login').send({ email: 'bob@example.com', password: 'nope nope nope' }).expect(401);
    }
    const locked = await client(app).post('/api/auth/login').send({ email: 'bob@example.com', password: PASSWORD }).expect(423);
    expect(locked.body.error.code).toBe('locked');

    const users = await admin.get('/api/admin/users').expect(200);
    expect(users.body.items.find((u: { id: string }) => u.id === userId).lockedUntil).not.toBeNull();

    await admin.post(`/api/admin/users/${userId}/unlock`).expect(200);
    await client(app).post('/api/auth/login').send({ email: 'bob@example.com', password: PASSWORD }).expect(200);
  });

  it('resets the failure counter after a successful login', async () => {
    await createUser(app, admin, 'carol@example.com');
    for (let i = 0; i < 4; i++) {
      await client(app).post('/api/auth/login').send({ email: 'carol@example.com', password: 'bad bad bad bad' }).expect(401);
    }
    await client(app).post('/api/auth/login').send({ email: 'carol@example.com', password: PASSWORD }).expect(200);
    for (let i = 0; i < 4; i++) {
      await client(app).post('/api/auth/login').send({ email: 'carol@example.com', password: 'bad bad bad bad' }).expect(401);
    }
    await client(app).post('/api/auth/login').send({ email: 'carol@example.com', password: PASSWORD }).expect(200);
  });

  it('refuses disabled accounts and kills their sessions', async () => {
    const { agent, userId } = await createUser(app, admin, 'dave@example.com');
    await agent.get('/api/auth/me').expect(200);
    await admin.patch(`/api/admin/users/${userId}`).send({ status: 'disabled' }).expect(200);
    await agent.get('/api/auth/me').expect(401);
    const res = await client(app).post('/api/auth/login').send({ email: 'dave@example.com', password: PASSWORD }).expect(403);
    expect(res.body.error.message).toMatch(/disabled/);
  });

  it('validates the login payload', async () => {
    await client(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
    await client(app).post('/api/auth/login').send({}).expect(400);
  });
});

describe('session lifecycle', () => {
  it('rejects unauthenticated access', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/workspaces').expect(401);
  });

  it('rejects a forged session cookie', async () => {
    await request(app).get('/api/auth/me').set('Cookie', 'lc_session=lcs_forged').expect(401);
  });

  it('logs out and invalidates the session server-side', async () => {
    const agent = client(app);
    const login = await agent.post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD }).expect(200);
    const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;
    await agent.post('/api/auth/logout').expect(204);
    // Replaying the old cookie must not work any more.
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('lists and revokes own sessions', async () => {
    const second = client(app);
    await second.post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD }).expect(200);
    const list = await admin.get('/api/account/sessions').expect(200);
    expect(list.body.items).toHaveLength(2);
    const other = list.body.items.find((s: { current: boolean }) => !s.current);
    await admin.delete(`/api/account/sessions/${other.id}`).expect(204);
    await second.get('/api/auth/me').expect(401);
    await admin.get('/api/auth/me').expect(200);
  });

  it('cannot revoke another user\'s session', async () => {
    const { agent } = await createUser(app, admin, 'erin@example.com');
    const theirs = await agent.get('/api/account/sessions').expect(200);
    await admin.delete(`/api/account/sessions/${theirs.body.items[0].id}`).expect(404);
  });
});

describe('password change', () => {
  it('requires the current password', async () => {
    const res = await admin
      .post('/api/auth/password')
      .send({ currentPassword: 'wrong wrong wrong', newPassword: 'another long passphrase' })
      .expect(400);
    expect(res.body.error.details[0].path).toBe('currentPassword');
  });

  it('enforces the policy and difference from the old password', async () => {
    await admin.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
    await admin.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
  });

  it('changes the password and signs out other devices', async () => {
    const other = client(app);
    await other.post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD }).expect(200);
    await admin
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'a brand new passphrase' })
      .expect(204);
    await admin.get('/api/auth/me').expect(200);
    await other.get('/api/auth/me').expect(401);
    await client(app).post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD }).expect(401);
    await client(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'a brand new passphrase' }).expect(200);
  });
});

describe('self-registration', () => {
  it('is disabled by default', async () => {
    await client(app).post('/api/auth/register').send({ email: 'new@example.com', name: 'New', password: PASSWORD }).expect(403);
  });

  it('works when an admin enables it, as a regular user', async () => {
    const settings = (await admin.get('/api/admin/settings').expect(200)).body;
    settings.general.registrationEnabled = true;
    await admin.put('/api/admin/settings').send(settings).expect(200);

    const agent = client(app);
    const res = await agent.post('/api/auth/register').send({ email: 'new@example.com', name: 'New', password: PASSWORD }).expect(201);
    expect(res.body.user.role).toBe('user');
    await agent.get('/api/auth/me').expect(200);
    await agent.get('/api/admin/users').expect(403);

    await client(app).post('/api/auth/register').send({ email: 'new@example.com', name: 'Dup', password: PASSWORD }).expect(409);
  });
});
