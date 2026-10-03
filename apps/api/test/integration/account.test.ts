import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { addMember, createProject, createUser, freshApp, mcpClient, setupAdmin, type Agent } from '../helpers';

let app: Express;
let admin: Agent;
let wsId: string;

beforeEach(async () => {
  app = freshApp();
  ({ agent: admin, workspaceId: wsId } = await setupAdmin(app));
});

describe('profile', () => {
  it('updates the display name', async () => {
    const res = await admin.patch('/api/account/profile').send({ name: '  Grace  ' }).expect(200);
    expect(res.body.user.name).toBe('Grace');
    await admin.patch('/api/account/profile').send({ name: '' }).expect(400);
  });
});

describe('personal access tokens', () => {
  it('shows the secret once and only stores a hash', async () => {
    const created = (await admin.post('/api/account/tokens').send({ name: 'Laptop', expiresInDays: 30 }).expect(201)).body;
    expect(created.secret).toMatch(/^lc_pat_/);
    expect(created.token).toMatchObject({ name: 'Laptop', projectId: null, workspaceId: null, revokedAt: null });
    expect(created.secret.startsWith(created.token.prefix)).toBe(true);
    const list = (await admin.get('/api/account/tokens').expect(200)).body.items;
    expect(JSON.stringify(list)).not.toContain(created.secret);
  });

  it('scopes tokens to a workspace or a project the user can edit', async () => {
    const p = await createProject(admin, wsId);
    const ws = (await admin.post('/api/account/tokens').send({ name: 'ws', expiresInDays: 5, workspaceId: wsId }).expect(201)).body;
    expect(ws.token.workspaceName).toBe('Acme');
    const pr = (await admin.post('/api/account/tokens').send({ name: 'p', expiresInDays: 5, projectId: p.id }).expect(201)).body;
    expect(pr.token.projectName).toBe('SHOP project');
    await admin.post('/api/account/tokens').send({ name: 'both', expiresInDays: 5, projectId: p.id, workspaceId: wsId }).expect(400);

    const { agent: viewer } = await createUser(app, admin, 'viewer@example.com');
    await addMember(admin, wsId, 'viewer@example.com', 'viewer');
    await viewer.post('/api/account/tokens').send({ name: 'x', expiresInDays: 5, projectId: p.id }).expect(403);
    const { agent: stranger } = await createUser(app, admin, 'stranger@example.com');
    await stranger.post('/api/account/tokens').send({ name: 'x', expiresInDays: 5, workspaceId: wsId }).expect(404);
  });

  it('validates lifetime and name', async () => {
    await admin.post('/api/account/tokens').send({ name: 'x', expiresInDays: 0 }).expect(400);
    await admin.post('/api/account/tokens').send({ name: '', expiresInDays: 5 }).expect(400);
    await admin.post('/api/account/tokens').send({ name: 'x', expiresInDays: 9999 }).expect(400);
  });

  it('revokes own tokens only', async () => {
    const mine = (await admin.post('/api/account/tokens').send({ name: 'mine', expiresInDays: 5 }).expect(201)).body;
    const { agent: other } = await createUser(app, admin, 'other@example.com');
    await other.delete(`/api/account/tokens/${mine.token.id}`).expect(404);
    await admin.delete(`/api/account/tokens/${mine.token.id}`).expect(204);
    await admin.delete(`/api/account/tokens/${mine.token.id}`).expect(404);
    expect((await mcpClient(app, mine.secret).initialize()).status).toBe(401);
    const list = (await admin.get('/api/account/tokens').expect(200)).body.items;
    expect(list[0].revokedAt).not.toBeNull();
  });

  it('records when a token was last used', async () => {
    const t = (await admin.post('/api/account/tokens').send({ name: 'used', expiresInDays: 5 }).expect(201)).body;
    await mcpClient(app, t.secret).initialize();
    const list = (await admin.get('/api/account/tokens').expect(200)).body.items;
    expect(list[0].lastUsedAt).not.toBeNull();
  });
});
