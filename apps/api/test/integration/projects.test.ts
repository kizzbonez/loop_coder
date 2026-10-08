import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { addMember, columnId, createProject, createUser, freshApp, setupAdmin, type Agent } from '../helpers';

let app: Express;
let owner: Agent;
let editor: Agent;
let viewer: Agent;
let outsider: Agent;
let wsId: string;

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  ({ agent: owner } = await createUser(app, admin.agent, 'owner@example.com'));
  ({ agent: editor } = await createUser(app, admin.agent, 'editor@example.com'));
  ({ agent: viewer } = await createUser(app, admin.agent, 'viewer@example.com'));
  ({ agent: outsider } = await createUser(app, admin.agent, 'outsider@example.com'));
  wsId = (await owner.post('/api/workspaces').send({ name: 'Team' }).expect(201)).body.id;
  await addMember(owner, wsId, 'editor@example.com', 'editor');
  await addMember(owner, wsId, 'viewer@example.com', 'viewer');
});

describe('projects', () => {
  it('creates a project with the default SDLC board', async () => {
    const project = await createProject(owner, wsId, 'shop');
    expect(project).toMatchObject({ key: 'SHOP', agentState: 'active', workspacePath: 'team/shop', kickoffCompletedAt: null });
    expect(project.columns.map((c) => c.kind)).toEqual(['backlog', 'todo', 'in_progress', 'review', 'testing', 'blocked', 'done']);
    const roles = (await owner.get('/api/agent-roles').expect(200)).body.items as Array<{ id: string; key: string }>;
    const roleKey = (id: string | null) => roles.find((r) => r.id === id)?.key ?? null;
    expect(project.columns.map((c) => roleKey(c.agentRoleId))).toEqual([
      'project_manager',
      'senior_developer',
      'senior_developer',
      'code_reviewer',
      'qa_engineer',
      null,
      null,
    ]);
    const detail = (await owner.get(`/api/projects/${project.id}`).expect(200)).body;
    expect(detail.definitionOfReady).toMatch(/acceptance criteria/i);
    expect(detail.definitionOfDone).toMatch(/reviewed/i);
    expect(detail.activeSprint).toBeNull();
    expect(detail.agent.online).toBe(false);
  });

  it('enforces globally unique, well-formed keys', async () => {
    await createProject(owner, wsId, 'SHOP');
    await owner.post('/api/projects').send({ workspaceId: wsId, name: 'Dup', key: 'shop' }).expect(409);
    await owner.post('/api/projects').send({ workspaceId: wsId, name: 'Bad', key: '1X' }).expect(400);
  });

  it('lets editors create projects but not viewers or outsiders', async () => {
    await createProject(editor, wsId, 'EDIT');
    await viewer.post('/api/projects').send({ workspaceId: wsId, name: 'V', key: 'VIEW' }).expect(403);
    await outsider.post('/api/projects').send({ workspaceId: wsId, name: 'O', key: 'OUT' }).expect(404);
  });

  it('inherits access from the workspace', async () => {
    const p = await createProject(owner, wsId);
    expect((await editor.get(`/api/projects/${p.id}`).expect(200)).body.myAccess).toBe('editor');
    expect((await viewer.get(`/api/projects/${p.id}`).expect(200)).body.myAccess).toBe('viewer');
    await outsider.get(`/api/projects/${p.id}`).expect(404);
    await outsider.get(`/api/projects/${p.id}/tasks`).expect(404);
    await outsider.get(`/api/projects/${p.id}/activity`).expect(404);
  });

  it('lists projects across my workspaces and per workspace', async () => {
    await createProject(owner, wsId, 'AAA');
    const other = (await owner.post('/api/workspaces').send({ name: 'Other' }).expect(201)).body.id;
    await createProject(owner, other, 'BBB');
    expect((await owner.get('/api/projects').expect(200)).body.items).toHaveLength(2);
    expect((await owner.get(`/api/workspaces/${wsId}/projects`).expect(200)).body.items).toHaveLength(1);
    expect((await editor.get('/api/projects').expect(200)).body.items).toHaveLength(1);
  });

  it('only owners change project settings; editors may pause and resume the agent', async () => {
    const p = await createProject(owner, wsId);
    await editor.patch(`/api/projects/${p.id}`).send({ name: 'Renamed' }).expect(403);
    await viewer.patch(`/api/projects/${p.id}`).send({ agentState: 'paused' }).expect(403);
    const paused = await editor.patch(`/api/projects/${p.id}`).send({ agentState: 'paused' }).expect(200);
    expect(paused.body.agentState).toBe('paused');
    const updated = await owner
      .patch(`/api/projects/${p.id}`)
      .send({ name: 'Renamed', definitionOfDone: '- shipped', notes: 'n', sprintCapacity: 30 })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Renamed', definitionOfDone: '- shipped', notes: 'n', sprintCapacity: 30 });
    const activity = (await owner.get(`/api/projects/${p.id}/activity`).expect(200)).body.items;
    expect(activity.map((a: { action: string }) => a.action)).toContain('agent.paused');
  });

  it('configures columns (name, WIP, role) and protects human columns', async () => {
    const p = await createProject(owner, wsId);
    const roles = (await owner.get('/api/agent-roles').expect(200)).body.items as Array<{ id: string; key: string }>;
    const architect = roles.find((r) => r.key === 'architect')!.id;
    const res = await owner
      .patch(`/api/projects/${p.id}/columns/${columnId(p, 'review')}`)
      .send({ name: 'Peer Review', wipLimit: 3, agentRoleId: architect, color: '#ff0088' })
      .expect(200);
    expect(res.body.items.find((c: { kind: string }) => c.kind === 'review')).toMatchObject({
      name: 'Peer Review',
      wipLimit: 3,
      agentRoleId: architect,
      color: '#ff0088',
    });
    await owner.patch(`/api/projects/${p.id}/columns/${columnId(p, 'done')}`).send({ agentRoleId: architect }).expect(400);
    await editor.patch(`/api/projects/${p.id}/columns/${columnId(p, 'review')}`).send({ name: 'x' }).expect(403);
    await owner
      .patch(`/api/projects/${p.id}/columns/${columnId(p, 'review')}`)
      .send({ agentRoleId: '6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e6f' })
      .expect(400);
  });

  it('deletes a project (owner only)', async () => {
    const p = await createProject(owner, wsId);
    await editor.delete(`/api/projects/${p.id}`).expect(403);
    await owner.delete(`/api/projects/${p.id}`).expect(204);
    await owner.get(`/api/projects/${p.id}`).expect(404);
  });

  it('computes project statistics excluding epics', async () => {
    const p = await createProject(owner, wsId);
    await owner.post(`/api/projects/${p.id}/tasks`).send({ title: 'Epic', type: 'epic' }).expect(201);
    await owner.post(`/api/projects/${p.id}/tasks`).send({ title: 'A', storyPoints: 3 }).expect(201);
    await owner.post(`/api/projects/${p.id}/tasks`).send({ title: 'B', storyPoints: 5, columnId: columnId(p, 'done') }).expect(201);
    const stats = (await owner.get(`/api/projects/${p.id}`).expect(200)).body.stats;
    expect(stats).toEqual({ total: 2, done: 1, points: 8, donePoints: 5, blocked: 0 });
  });
});
