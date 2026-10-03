import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { addMember, columnId, createProject, createUser, freshApp, setupAdmin, type Agent } from '../helpers';

let app: Express;
let owner: Agent;
let viewer: Agent;
let project: Awaited<ReturnType<typeof createProject>>;
let wsId: string;

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  owner = admin.agent;
  wsId = admin.workspaceId;
  ({ agent: viewer } = await createUser(app, admin.agent, 'viewer@example.com'));
  await addMember(owner, wsId, 'viewer@example.com', 'viewer');
  project = await createProject(owner, wsId);
});

const create = (body: Record<string, unknown>) => owner.post(`/api/projects/${project.id}/tasks`).send(body);

describe('work items', () => {
  it('creates items in the backlog with sequential keys', async () => {
    const a = (await create({ title: 'First' }).expect(201)).body;
    const b = (await create({ title: 'Second', type: 'bug', priority: 'high', storyPoints: 3, labels: ['ui'] }).expect(201)).body;
    expect(a).toMatchObject({ key: 'SHOP-1', number: 1, type: 'story', columnId: columnId(project, 'backlog'), refined: false });
    expect(b).toMatchObject({ key: 'SHOP-2', type: 'bug', priority: 'high', storyPoints: 3, labels: ['ui'] });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('validates input', async () => {
    await create({ title: '' }).expect(400);
    await create({ title: 'x', storyPoints: 4 }).expect(400);
    await create({ title: 'x', priority: 'urgent' }).expect(400);
    await create({ title: 'x', columnId: '6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e6f' }).expect(400);
  });

  it('viewers can read but not write', async () => {
    const t = (await create({ title: 'Read me' }).expect(201)).body;
    await viewer.get(`/api/tasks/${t.id}`).expect(200);
    await viewer.post(`/api/projects/${project.id}/tasks`).send({ title: 'nope' }).expect(403);
    await viewer.patch(`/api/tasks/${t.id}`).send({ title: 'nope' }).expect(403);
    await viewer.delete(`/api/tasks/${t.id}`).expect(403);
    await viewer.post(`/api/tasks/${t.id}/remarks`).send({ body: 'hi' }).expect(403);
  });

  it('cannot touch items of other projects', async () => {
    const otherWs = (await owner.post('/api/workspaces').send({ name: 'Other' }).expect(201)).body.id;
    const other = await createProject(owner, otherWs, 'OTH');
    const foreign = (await owner.post(`/api/projects/${other.id}/tasks`).send({ title: 'Foreign' }).expect(201)).body;
    const mine = (await create({ title: 'Mine' }).expect(201)).body;
    await owner.patch(`/api/tasks/${mine.id}`).send({ dependsOn: [foreign.id] }).expect(400);
    await owner.post(`/api/tasks/${mine.id}/move`).send({ columnId: columnId(other, 'todo'), index: 0 }).expect(400);
    await viewer.get(`/api/tasks/${foreign.id}`).expect(404);
  });

  it('updates fields and records activity', async () => {
    const t = (await create({ title: 'Old' }).expect(201)).body;
    const res = await owner
      .patch(`/api/tasks/${t.id}`)
      .send({ title: 'New', acceptanceCriteria: '- Given…', storyPoints: 5, refined: true })
      .expect(200);
    expect(res.body).toMatchObject({ title: 'New', acceptanceCriteria: '- Given…', storyPoints: 5, refined: true });
    const activity = (await owner.get(`/api/projects/${project.id}/activity`).expect(200)).body.items;
    expect(activity[0]).toMatchObject({ action: 'task.updated', taskKey: 'SHOP-1' });
  });

  it('validates dependencies: same project, no self, no cycles', async () => {
    const a = (await create({ title: 'A' }).expect(201)).body;
    const b = (await create({ title: 'B', dependsOn: [a.id] }).expect(201)).body;
    expect(b.dependsOn).toEqual([a.id]);
    await owner.patch(`/api/tasks/${a.id}`).send({ dependsOn: [a.id] }).expect(400);
    const cycle = await owner.patch(`/api/tasks/${a.id}`).send({ dependsOn: [b.id] }).expect(400);
    expect(cycle.body.error.message).toMatch(/cycle/);
    const c = (await create({ title: 'C', dependsOn: [b.id] }).expect(201)).body;
    await owner.patch(`/api/tasks/${a.id}`).send({ dependsOn: [c.id] }).expect(400);
    await owner.patch(`/api/tasks/${c.id}`).send({ dependsOn: [] }).expect(200);
  });

  it('only epics can be parents', async () => {
    const story = (await create({ title: 'Story' }).expect(201)).body;
    await create({ title: 'Child', parentId: story.id }).expect(400);
    const epic = (await create({ title: 'Epic', type: 'epic' }).expect(201)).body;
    const child = (await create({ title: 'Child', parentId: epic.id }).expect(201)).body;
    expect(child.parentId).toBe(epic.id);
    await owner.patch(`/api/tasks/${epic.id}`).send({ type: 'story' }).expect(400);
  });

  it('reorders within a column and moves across columns', async () => {
    const a = (await create({ title: 'A' }).expect(201)).body;
    const b = (await create({ title: 'B' }).expect(201)).body;
    const c = (await create({ title: 'C' }).expect(201)).body;
    await owner.post(`/api/tasks/${c.id}/move`).send({ columnId: columnId(project, 'backlog'), index: 0 }).expect(200);
    let tasks = (await owner.get(`/api/projects/${project.id}/tasks`).expect(200)).body.items as Array<{ id: string; columnId: string }>;
    expect(tasks.filter((t) => t.columnId === columnId(project, 'backlog')).map((t) => t.id)).toEqual([c.id, a.id, b.id]);

    await owner.post(`/api/tasks/${a.id}/move`).send({ columnId: columnId(project, 'backlog'), index: 3 }).expect(200);
    tasks = (await owner.get(`/api/projects/${project.id}/tasks`).expect(200)).body.items;
    expect(tasks.filter((t) => t.columnId === columnId(project, 'backlog')).map((t) => t.id)).toEqual([c.id, b.id, a.id]);

    const done = await owner.post(`/api/tasks/${b.id}/move`).send({ columnId: columnId(project, 'done'), index: 0 }).expect(200);
    expect(done.body.completedAt).not.toBeNull();
    const back = await owner.post(`/api/tasks/${b.id}/move`).send({ columnId: columnId(project, 'todo'), index: 0 }).expect(200);
    expect(back.body.completedAt).toBeNull();
  });

  it('keeps many interleaved inserts ordered (fractional positions + renumbering)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await create({ title: `T${i}` }).expect(201)).body.id);
    // Repeatedly insert at index 1 to exhaust the gap between two neighbours.
    for (let i = 0; i < 60; i++) {
      await owner.post(`/api/tasks/${ids[5]}/move`).send({ columnId: columnId(project, 'backlog'), index: 1 }).expect(200);
      await owner.post(`/api/tasks/${ids[4]}/move`).send({ columnId: columnId(project, 'backlog'), index: 1 }).expect(200);
    }
    const tasks = (await owner.get(`/api/projects/${project.id}/tasks`).expect(200)).body.items as Array<{ id: string; position: number }>;
    const positions = tasks.map((t) => t.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(tasks[0]!.id).toBe(ids[0]);
    expect(tasks[1]!.id).toBe(ids[4]);
  });

  it('completes an epic when all children are done and re-opens it otherwise', async () => {
    const epic = (await create({ title: 'Epic', type: 'epic' }).expect(201)).body;
    const c1 = (await create({ title: 'C1', parentId: epic.id }).expect(201)).body;
    const c2 = (await create({ title: 'C2', parentId: epic.id }).expect(201)).body;
    const doneCol = columnId(project, 'done');
    await owner.post(`/api/tasks/${c1.id}/move`).send({ columnId: doneCol, index: 0 }).expect(200);
    expect((await owner.get(`/api/tasks/${epic.id}`).expect(200)).body.columnId).toBe(columnId(project, 'backlog'));
    await owner.post(`/api/tasks/${c2.id}/move`).send({ columnId: doneCol, index: 0 }).expect(200);
    expect((await owner.get(`/api/tasks/${epic.id}`).expect(200)).body.columnId).toBe(doneCol);
    await owner.post(`/api/tasks/${c2.id}/move`).send({ columnId: columnId(project, 'in_progress'), index: 0 }).expect(200);
    expect((await owner.get(`/api/tasks/${epic.id}`).expect(200)).body.columnId).toBe(columnId(project, 'backlog'));
  });

  it('deletes items and detaches their children', async () => {
    const epic = (await create({ title: 'Epic', type: 'epic' }).expect(201)).body;
    const child = (await create({ title: 'Child', parentId: epic.id }).expect(201)).body;
    await owner.delete(`/api/tasks/${epic.id}`).expect(204);
    await owner.get(`/api/tasks/${epic.id}`).expect(404);
    expect((await owner.get(`/api/tasks/${child.id}`).expect(200)).body.parentId).toBeNull();
  });

  it('assigns items to humans who are workspace members only', async () => {
    const t = (await create({ title: 'Human work' }).expect(201)).body;
    const me = (await owner.get('/api/auth/me').expect(200)).body.user.id;
    await owner.patch(`/api/tasks/${t.id}`).send({ assigneeUserId: me }).expect(200);
    await owner.patch(`/api/tasks/${t.id}`).send({ assigneeUserId: '6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e6f' }).expect(400);
  });

  it('adds sprint membership when dragged onto the sprint board', async () => {
    const sprint = (await owner.post(`/api/projects/${project.id}/sprints`).send({ name: 'S1', goal: 'g' }).expect(201)).body;
    await owner.post(`/api/sprints/${sprint.id}/start`).expect(200);
    const t = (await create({ title: 'Drag me' }).expect(201)).body;
    const moved = await owner.post(`/api/tasks/${t.id}/move`).send({ columnId: columnId(project, 'todo'), index: 0 }).expect(200);
    expect(moved.body.sprintId).toBe(sprint.id);
    const back = await owner.post(`/api/tasks/${t.id}/move`).send({ columnId: columnId(project, 'backlog'), index: 0 }).expect(200);
    expect(back.body.sprintId).toBeNull();
  });
});

describe('remarks and human answers', () => {
  it('adds comments with author information', async () => {
    const t = (await create({ title: 'Discuss' }).expect(201)).body;
    const res = await owner.post(`/api/tasks/${t.id}/remarks`).send({ body: 'Looks good' }).expect(201);
    expect(res.body.remarks).toHaveLength(1);
    expect(res.body.remarks[0]).toMatchObject({ body: 'Looks good', kind: 'comment', authorType: 'user', authorName: 'Ada Admin' });
    expect(res.body.remarkCount).toBe(1);
  });

  it('rejects empty remarks and agent-only kinds', async () => {
    const t = (await create({ title: 'x' }).expect(201)).body;
    await owner.post(`/api/tasks/${t.id}/remarks`).send({ body: '   ' }).expect(400);
    await owner.post(`/api/tasks/${t.id}/remarks`).send({ body: 'x', kind: 'system' }).expect(400);
  });

  it('answering a blocked item with resume returns it to where it was blocked', async () => {
    const t = (await create({ title: 'Blocked' }).expect(201)).body;
    await owner.post(`/api/tasks/${t.id}/move`).send({ columnId: columnId(project, 'review'), index: 0 }).expect(200);
    await owner.post(`/api/tasks/${t.id}/move`).send({ columnId: columnId(project, 'blocked'), index: 0 }).expect(200);
    const res = await owner.post(`/api/tasks/${t.id}/remarks`).send({ body: 'Use PostgreSQL', kind: 'answer', resume: true }).expect(201);
    expect(res.body.columnId).toBe(columnId(project, 'review'));
    expect(res.body.bounceCount).toBe(0);
  });

  it('resume falls back to the backlog when the origin is unknown', async () => {
    const t = (await create({ title: 'Blocked', columnId: columnId(project, 'blocked') }).expect(201)).body;
    const res = await owner.post(`/api/tasks/${t.id}/remarks`).send({ body: 'ok', kind: 'answer', resume: true }).expect(201);
    expect(res.body.columnId).toBe(columnId(project, 'backlog'));
  });

  it('counts rework when a human sends an item back from review', async () => {
    const t = (await create({ title: 'Rework' }).expect(201)).body;
    await owner.post(`/api/tasks/${t.id}/move`).send({ columnId: columnId(project, 'review'), index: 0 }).expect(200);
    const res = await owner.post(`/api/tasks/${t.id}/move`).send({ columnId: columnId(project, 'in_progress'), index: 0 }).expect(200);
    expect(res.body.bounceCount).toBe(1);
  });
});
