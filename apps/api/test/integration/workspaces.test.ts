import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { addMember, createProject, createUser, freshApp, setupAdmin, type Agent } from '../helpers';

let app: Express;
let admin: Agent;
let alice: Agent;
let aliceId: string;
let bob: Agent;
let bobId: string;

beforeEach(async () => {
  app = freshApp();
  ({ agent: admin } = await setupAdmin(app));
  ({ agent: alice, userId: aliceId } = await createUser(app, admin, 'alice@example.com'));
  ({ agent: bob, userId: bobId } = await createUser(app, admin, 'bob@example.com'));
});

describe('workspaces', () => {
  it('lets any user create a workspace they own', async () => {
    const res = await alice.post('/api/workspaces').send({ name: 'Alice Labs', description: 'R&D' }).expect(201);
    expect(res.body).toMatchObject({ name: 'Alice Labs', slug: 'alice-labs', myAccess: 'owner', memberCount: 1, projectCount: 0 });
    const list = await alice.get('/api/workspaces').expect(200);
    expect(list.body.items.map((w: { name: string }) => w.name)).toEqual(['Alice Labs']);
  });

  it('supports multiple workspaces per user', async () => {
    await alice.post('/api/workspaces').send({ name: 'One' }).expect(201);
    await alice.post('/api/workspaces').send({ name: 'Two' }).expect(201);
    const list = await alice.get('/api/workspaces').expect(200);
    expect(list.body.items).toHaveLength(2);
  });

  it('generates unique slugs and rejects taken custom slugs', async () => {
    const a = await alice.post('/api/workspaces').send({ name: 'Same Name' }).expect(201);
    const b = await bob.post('/api/workspaces').send({ name: 'Same Name' }).expect(201);
    expect(a.body.slug).toBe('same-name');
    expect(b.body.slug).toBe('same-name-2');
    await bob.post('/api/workspaces').send({ name: 'X', slug: 'same-name' }).expect(409);
    await bob.patch(`/api/workspaces/${b.body.id}`).send({ slug: 'same-name' }).expect(409);
  });

  it('hides workspaces from non-members', async () => {
    const ws = await alice.post('/api/workspaces').send({ name: 'Secret' }).expect(201);
    await bob.get(`/api/workspaces/${ws.body.id}`).expect(404);
    await bob.get(`/api/workspaces/${ws.body.id}/projects`).expect(404);
    await bob.patch(`/api/workspaces/${ws.body.id}`).send({ name: 'Hacked' }).expect(404);
    await bob.delete(`/api/workspaces/${ws.body.id}`).expect(404);
  });

  it('lets platform admins see every workspace', async () => {
    const ws = await alice.post('/api/workspaces').send({ name: 'Secret' }).expect(201);
    const res = await admin.get(`/api/workspaces/${ws.body.id}`).expect(200);
    expect(res.body.myAccess).toBe('admin');
    const all = await admin.get('/api/admin/workspaces').expect(200);
    expect(all.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('only owners can rename or delete', async () => {
    const ws = await alice.post('/api/workspaces').send({ name: 'Team' }).expect(201);
    await addMember(alice, ws.body.id, 'bob@example.com', 'editor');
    await bob.patch(`/api/workspaces/${ws.body.id}`).send({ name: 'Mine now' }).expect(403);
    await bob.delete(`/api/workspaces/${ws.body.id}`).expect(403);
    const renamed = await alice.patch(`/api/workspaces/${ws.body.id}`).send({ name: 'Team 2' }).expect(200);
    expect(renamed.body.name).toBe('Team 2');
  });

  it('deleting a workspace removes its projects', async () => {
    const ws = await alice.post('/api/workspaces').send({ name: 'Temp' }).expect(201);
    const project = await createProject(alice, ws.body.id, 'TMP');
    await alice.delete(`/api/workspaces/${ws.body.id}`).expect(204);
    await alice.get(`/api/projects/${project.id}`).expect(404);
  });
});

describe('workspace members', () => {
  let wsId: string;

  beforeEach(async () => {
    wsId = (await alice.post('/api/workspaces').send({ name: 'Team' }).expect(201)).body.id;
  });

  it('adds, lists, updates and removes members', async () => {
    await addMember(alice, wsId, 'bob@example.com', 'viewer');
    let members = (await alice.get(`/api/workspaces/${wsId}/members`).expect(200)).body.items;
    expect(members).toHaveLength(2);
    expect(members.find((m: { userId: string }) => m.userId === bobId).role).toBe('viewer');

    await alice.patch(`/api/workspaces/${wsId}/members/${bobId}`).send({ role: 'editor' }).expect(200);
    members = (await bob.get(`/api/workspaces/${wsId}/members`).expect(200)).body.items;
    expect(members.find((m: { userId: string }) => m.userId === bobId).role).toBe('editor');

    await alice.delete(`/api/workspaces/${wsId}/members/${bobId}`).expect(204);
    await bob.get(`/api/workspaces/${wsId}`).expect(404);
  });

  it('rejects unknown users and duplicates', async () => {
    await alice.post(`/api/workspaces/${wsId}/members`).send({ email: 'ghost@example.com', role: 'viewer' }).expect(404);
    await addMember(alice, wsId, 'bob@example.com', 'viewer');
    await alice.post(`/api/workspaces/${wsId}/members`).send({ email: 'bob@example.com', role: 'editor' }).expect(409);
  });

  it('non-owners cannot manage members', async () => {
    await addMember(alice, wsId, 'bob@example.com', 'editor');
    await bob.post(`/api/workspaces/${wsId}/members`).send({ email: 'admin@example.com', role: 'viewer' }).expect(403);
    await bob.patch(`/api/workspaces/${wsId}/members/${bobId}`).send({ role: 'owner' }).expect(403);
  });

  it('protects the workspace owner', async () => {
    await alice.patch(`/api/workspaces/${wsId}/members/${aliceId}`).send({ role: 'viewer' }).expect(400);
    await alice.delete(`/api/workspaces/${wsId}/members/${aliceId}`).expect(400);
  });

  it('lets members leave on their own', async () => {
    await addMember(alice, wsId, 'bob@example.com', 'viewer');
    await bob.delete(`/api/workspaces/${wsId}/members/${bobId}`).expect(204);
    await bob.get(`/api/workspaces/${wsId}`).expect(404);
  });

  it('transfers ownership to an existing member', async () => {
    await alice.post(`/api/workspaces/${wsId}/transfer`).send({ userId: bobId }).expect(400);
    await addMember(alice, wsId, 'bob@example.com', 'editor');
    const res = await alice.post(`/api/workspaces/${wsId}/transfer`).send({ userId: bobId }).expect(200);
    expect(res.body.ownerId).toBe(bobId);
    // The previous owner keeps the owner role and can be removed by the new owner.
    await bob.delete(`/api/workspaces/${wsId}/members/${aliceId}`).expect(204);
  });
});
