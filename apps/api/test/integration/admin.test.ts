import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { client, createProject, createToken, createUser, freshApp, mcpClient, PASSWORD, setupAdmin, type Agent } from '../helpers';

let app: Express;
let admin: Agent;
let adminId: string;
let wsId: string;

beforeEach(async () => {
  app = freshApp();
  ({ agent: admin, userId: adminId, workspaceId: wsId } = await setupAdmin(app));
});

describe('admin: users', () => {
  it('creates users with roles and validates input', async () => {
    const res = await admin
      .post('/api/admin/users')
      .send({ email: 'new@example.com', name: 'New', password: PASSWORD, role: 'admin' })
      .expect(201);
    expect(res.body).toMatchObject({ email: 'new@example.com', role: 'admin', status: 'active' });
    expect(res.body).not.toHaveProperty('passwordHash');
    await admin.post('/api/admin/users').send({ email: 'new@example.com', name: 'Dup', password: PASSWORD }).expect(409);
    await admin.post('/api/admin/users').send({ email: 'weak@example.com', name: 'Weak', password: 'short' }).expect(400);
  });

  it('never exposes password hashes', async () => {
    const res = await admin.get('/api/admin/users').expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt\$/);
  });

  it('promotes and demotes users', async () => {
    const { agent, userId } = await createUser(app, admin, 'u@example.com');
    await agent.get('/api/admin/stats').expect(403);
    await admin.patch(`/api/admin/users/${userId}`).send({ role: 'admin' }).expect(200);
    await agent.get('/api/admin/stats').expect(200);
    await admin.patch(`/api/admin/users/${userId}`).send({ role: 'user' }).expect(200);
    await agent.get('/api/admin/stats').expect(403);
  });

  it('protects the acting admin and the last administrator', async () => {
    await admin.patch(`/api/admin/users/${adminId}`).send({ role: 'user' }).expect(400);
    await admin.patch(`/api/admin/users/${adminId}`).send({ status: 'disabled' }).expect(400);
    await admin.delete(`/api/admin/users/${adminId}`).expect(400);

    const { agent: second, userId: secondId } = await createUser(app, admin, 'second@example.com', 'admin');
    await second.patch(`/api/admin/users/${adminId}`).send({ role: 'user' }).expect(200);
    // `second` is now the only admin and cannot be demoted by anyone.
    await second.patch(`/api/admin/users/${secondId}`).send({ role: 'user' }).expect(400);
  });

  it('resets passwords and signs the user out everywhere', async () => {
    const { agent, userId } = await createUser(app, admin, 'reset@example.com');
    await admin.post(`/api/admin/users/${userId}/reset-password`).send({ password: 'short' }).expect(400);
    await admin.post(`/api/admin/users/${userId}/reset-password`).send({ password: 'totally new passphrase' }).expect(204);
    await agent.get('/api/auth/me').expect(401);
    await client(app).post('/api/auth/login').send({ email: 'reset@example.com', password: 'totally new passphrase' }).expect(200);
  });

  it('revokes all sessions of a user', async () => {
    const { agent, userId } = await createUser(app, admin, 'kick@example.com');
    const res = await admin.post(`/api/admin/users/${userId}/revoke-sessions`).expect(200);
    expect(res.body.revoked).toBe(1);
    await agent.get('/api/auth/me').expect(401);
  });

  it('disabling a user revokes their MCP tokens', async () => {
    const { agent, userId } = await createUser(app, admin, 'bot@example.com');
    const token = await createToken(agent);
    await admin.patch(`/api/admin/users/${userId}`).send({ status: 'disabled' }).expect(200);
    await admin.patch(`/api/admin/users/${userId}`).send({ status: 'active' }).expect(200);
    expect((await mcpClient(app, token).initialize()).status).toBe(401);
  });

  it('deleting a user transfers their workspaces to the acting admin', async () => {
    const { agent, userId } = await createUser(app, admin, 'leaver@example.com');
    const ws = (await agent.post('/api/workspaces').send({ name: 'Leaver WS' }).expect(201)).body;
    await createProject(agent, ws.id, 'LEAVE');
    await admin.delete(`/api/admin/users/${userId}`).expect(204);
    const mine = (await admin.get('/api/workspaces').expect(200)).body.items;
    expect(mine.find((w: { id: string }) => w.id === ws.id)).toMatchObject({ ownerId: adminId });
    expect((await admin.get(`/api/workspaces/${ws.id}/projects`).expect(200)).body.items).toHaveLength(1);
  });
});

describe('admin: agent roles', () => {
  it('lists the eleven built-in SDLC roles', async () => {
    const roles = (await admin.get('/api/admin/agent-roles').expect(200)).body.items;
    expect(roles.map((r: { key: string }) => r.key).sort()).toEqual(
      [
        'architect',
        'backend_developer',
        'code_reviewer',
        'devops_engineer',
        'frontend_developer',
        'project_manager',
        'qa_engineer',
        'security_engineer',
        'senior_developer',
        'tech_writer',
        'ui_designer',
      ].sort(),
    );
    expect(roles.every((r: { isSystem: boolean }) => r.isSystem)).toBe(true);
  });

  it('creates, edits and deletes custom roles', async () => {
    const role = (await admin
      .post('/api/admin/agent-roles')
      .send({ key: 'data_scientist', name: 'Data Scientist', instructions: 'Analyse data', color: '#123456' })
      .expect(201)).body;
    expect(role).toMatchObject({ key: 'data_scientist', isSystem: false, enabled: true });
    await admin.post('/api/admin/agent-roles').send({ key: 'data_scientist', name: 'Dup', instructions: 'x' }).expect(409);
    await admin.post('/api/admin/agent-roles').send({ key: 'Bad Key', name: 'x', instructions: 'x' }).expect(400);
    const edited = (await admin.patch(`/api/admin/agent-roles/${role.id}`).send({ instructions: 'Better' }).expect(200)).body;
    expect(edited.instructions).toBe('Better');
    await admin.delete(`/api/admin/agent-roles/${role.id}`).expect(204);
  });

  it('protects built-in roles and roles in use', async () => {
    const roles = (await admin.get('/api/admin/agent-roles').expect(200)).body.items;
    const pm = roles.find((r: { key: string }) => r.key === 'project_manager');
    await admin.delete(`/api/admin/agent-roles/${pm.id}`).expect(400);
    const custom = (await admin.post('/api/admin/agent-roles').send({ key: 'mapped', name: 'M', instructions: 'x' }).expect(201)).body;
    const p = await createProject(admin, wsId);
    await admin.patch(`/api/projects/${p.id}/columns/${p.columns[3]!.id}`).send({ agentRoleId: custom.id }).expect(200);
    await admin.delete(`/api/admin/agent-roles/${custom.id}`).expect(409);
  });

  it('edits to role instructions reach the agent', async () => {
    const roles = (await admin.get('/api/admin/agent-roles').expect(200)).body.items;
    const pm = roles.find((r: { key: string }) => r.key === 'project_manager');
    await admin.patch(`/api/admin/agent-roles/${pm.id}`).send({ instructions: 'CUSTOM PM PLAYBOOK' }).expect(200);
    await createProject(admin, wsId);
    const mcp = mcpClient(app, await createToken(admin));
    expect(await mcp.ok('get_next_work', { project: 'SHOP' })).toContain('CUSTOM PM PLAYBOOK');
  });
});

describe('admin: settings', () => {
  it('validates and applies settings', async () => {
    const settings = (await admin.get('/api/admin/settings').expect(200)).body;
    await admin.put('/api/admin/settings').send({ ...settings, security: { ...settings.security, passwordMinLength: 2 } }).expect(400);
    settings.security.passwordMinLength = 20;
    settings.general.appName = 'Renamed Board';
    await admin.put('/api/admin/settings').send(settings).expect(200);
    const config = (await client(app).get('/api/config').expect(200)).body;
    expect(config).toMatchObject({ appName: 'Renamed Board', passwordMinLength: 20 });
    await admin.post('/api/admin/users').send({ email: 'x@example.com', name: 'X', password: 'only sixteen chr' }).expect(400);
  });

  it('caps token lifetime', async () => {
    const settings = (await admin.get('/api/admin/settings').expect(200)).body;
    settings.security.tokenMaxDays = 7;
    await admin.put('/api/admin/settings').send(settings).expect(200);
    await admin.post('/api/account/tokens').send({ name: 't', expiresInDays: 30 }).expect(400);
    await admin.post('/api/account/tokens').send({ name: 't', expiresInDays: 7 }).expect(201);
  });
});

describe('admin: oversight', () => {
  it('reports platform statistics', async () => {
    await createProject(admin, wsId);
    const stats = (await admin.get('/api/admin/stats').expect(200)).body;
    expect(stats).toMatchObject({ users: 1, admins: 1, workspaces: 1, projects: 1 });
  });

  it('reports system information with the schema version', async () => {
    const info = (await admin.get('/api/admin/system').expect(200)).body;
    expect(info.version.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.database.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(info.node).toMatch(/^v\d+/);
  });

  it('lists and revokes any token', async () => {
    const { agent } = await createUser(app, admin, 'tok@example.com');
    const secret = await createToken(agent);
    const tokens = (await admin.get('/api/admin/tokens').expect(200)).body.items;
    expect(tokens[0]).toMatchObject({ userEmail: 'tok@example.com' });
    expect(JSON.stringify(tokens)).not.toContain(secret);
    await admin.delete(`/api/admin/tokens/${tokens[0].id}`).expect(204);
    expect((await mcpClient(app, secret).initialize()).status).toBe(401);
  });

  it('keeps an audit trail that can be filtered', async () => {
    await client(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'wrong wrong wrong' }).expect(401);
    await createUser(app, admin, 'audited@example.com');
    const all = (await admin.get('/api/admin/audit?limit=200').expect(200)).body.items as Array<{ action: string }>;
    const actions = all.map((a) => a.action);
    for (const a of ['setup.completed', 'auth.login_failed', 'admin.user_created', 'auth.login']) expect(actions).toContain(a);
    const filtered = (await admin.get('/api/admin/audit?action=auth.login_failed').expect(200)).body.items;
    expect(filtered.every((a: { action: string }) => a.action.startsWith('auth.login_failed'))).toBe(true);
  });

  it('paginates the audit log with a cursor', async () => {
    for (let i = 0; i < 5; i++) await createUser(app, admin, `p${i}@example.com`);
    const first = (await admin.get('/api/admin/audit?limit=3').expect(200)).body;
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = (await admin.get(`/api/admin/audit?limit=3&before=${encodeURIComponent(first.nextCursor)}`).expect(200)).body;
    expect(second.items.length).toBeGreaterThan(0);
  });

  it('downloads a consistent SQLite backup', async () => {
    const res = await admin
      .get('/api/admin/backup')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="loopcoder-backup-.*\.db"/);
    expect((res.body as Buffer).subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('lists all projects and agent sessions', async () => {
    await createProject(admin, wsId);
    const mcp = mcpClient(app, await createToken(admin));
    await mcp.ok('get_next_work', { project: 'SHOP' });
    expect((await admin.get('/api/admin/projects').expect(200)).body.items).toHaveLength(1);
    const sessions = (await admin.get('/api/admin/agent-sessions').expect(200)).body.items;
    expect(sessions[0]).toMatchObject({ projectName: 'SHOP project', online: true });
  });
});
