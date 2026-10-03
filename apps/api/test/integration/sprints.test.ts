import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { columnId, createProject, freshApp, setupAdmin, type Agent } from '../helpers';

let app: Express;
let owner: Agent;
let project: Awaited<ReturnType<typeof createProject>>;

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  owner = admin.agent;
  project = await createProject(owner, admin.workspaceId);
});

const create = (body: Record<string, unknown>) =>
  owner.post(`/api/projects/${project.id}/tasks`).send(body).expect(201).then((r) => r.body);
const newSprint = (name = 'Sprint A', goal = 'Ship login') =>
  owner.post(`/api/projects/${project.id}/sprints`).send({ name, goal }).expect(201).then((r) => r.body);

describe('sprints', () => {
  it('creates numbered planned sprints', async () => {
    const a = await newSprint();
    const b = await newSprint('Sprint B');
    expect(a).toMatchObject({ number: 1, status: 'planned', name: 'Sprint A', goal: 'Ship login' });
    expect(b.number).toBe(2);
    const list = (await owner.get(`/api/projects/${project.id}/sprints`).expect(200)).body.items;
    expect(list.map((s: { number: number }) => s.number)).toEqual([2, 1]);
  });

  it('starting a sprint moves committed backlog items to To Do', async () => {
    const sprint = await newSprint();
    const item = await create({ title: 'Login', storyPoints: 3, refined: true });
    await owner.patch(`/api/tasks/${item.id}`).send({ sprintId: sprint.id }).expect(200);
    expect((await owner.get(`/api/tasks/${item.id}`).expect(200)).body.columnId).toBe(columnId(project, 'backlog'));

    const started = (await owner.post(`/api/sprints/${sprint.id}/start`).expect(200)).body;
    expect(started.status).toBe('active');
    expect(started.startedAt).not.toBeNull();
    expect((await owner.get(`/api/tasks/${item.id}`).expect(200)).body.columnId).toBe(columnId(project, 'todo'));
    expect((await owner.get(`/api/projects/${project.id}`).expect(200)).body.activeSprint.id).toBe(sprint.id);
  });

  it('allows only one active sprint', async () => {
    const a = await newSprint();
    const b = await newSprint('B');
    await owner.post(`/api/sprints/${a.id}/start`).expect(200);
    await owner.post(`/api/sprints/${b.id}/start`).expect(409);
    await owner.post(`/api/sprints/${a.id}/start`).expect(400);
  });

  it('completing a sprint returns unstarted work, carries over started work, keeps done work', async () => {
    const sprint = await newSprint();
    await owner.post(`/api/sprints/${sprint.id}/start`).expect(200);
    const todo = await create({ title: 'Not started', columnId: columnId(project, 'todo') });
    const doing = await create({ title: 'Started', columnId: columnId(project, 'in_progress') });
    const finished = await create({ title: 'Done', columnId: columnId(project, 'testing'), storyPoints: 2 });
    for (const t of [todo, doing, finished]) expect(t.sprintId).toBe(sprint.id);
    const done = (await owner.post(`/api/tasks/${finished.id}/move`).send({ columnId: columnId(project, 'done'), index: 0 }).expect(200)).body;

    const completed = (await owner
      .post(`/api/sprints/${sprint.id}/complete`)
      .send({ reviewNotes: 'Login shipped', retroNotes: 'Smaller stories' })
      .expect(200)).body;
    expect(completed).toMatchObject({ status: 'completed', reviewNotes: 'Login shipped', retroNotes: 'Smaller stories' });
    expect(completed.stats).toMatchObject({ total: 1, done: 1 });

    const after = async (id: string) => (await owner.get(`/api/tasks/${id}`).expect(200)).body;
    expect(await after(todo.id)).toMatchObject({ columnId: columnId(project, 'backlog'), sprintId: null, refined: true });
    expect(await after(doing.id)).toMatchObject({ columnId: columnId(project, 'in_progress'), sprintId: null });
    expect(await after(done.id)).toMatchObject({ sprintId: sprint.id });

    // Carried-over work joins the next sprint automatically.
    const next = await newSprint('Next');
    await owner.post(`/api/sprints/${next.id}/start`).expect(200);
    expect((await after(doing.id)).sprintId).toBe(next.id);
  });

  it('carries blocked sprint work into the next sprint, but not items blocked during refinement', async () => {
    const parkedInRefinement = await create({ title: 'Needs a decision' });
    await owner.post(`/api/tasks/${parkedInRefinement.id}/move`).send({ columnId: columnId(project, 'blocked'), index: 0 }).expect(200);

    const first = await newSprint('S1');
    await owner.post(`/api/sprints/${first.id}/start`).expect(200);
    const midSprint = await create({ title: 'Blocked while building', columnId: columnId(project, 'in_progress') });
    await owner.post(`/api/tasks/${midSprint.id}/move`).send({ columnId: columnId(project, 'blocked'), index: 0 }).expect(200);
    await owner.post(`/api/sprints/${first.id}/complete`).send({}).expect(200);

    const second = await newSprint('S2');
    await owner.post(`/api/sprints/${second.id}/start`).expect(200);
    const sprintOf = async (id: string) => (await owner.get(`/api/tasks/${id}`).expect(200)).body.sprintId;
    expect(await sprintOf(midSprint.id)).toBe(second.id);
    expect(await sprintOf(parkedInRefinement.id)).toBeNull();
  });

  it('only the active sprint can be completed; completed sprints are read-only', async () => {
    const sprint = await newSprint();
    await owner.post(`/api/sprints/${sprint.id}/complete`).send({}).expect(400);
    await owner.post(`/api/sprints/${sprint.id}/start`).expect(200);
    await owner.post(`/api/sprints/${sprint.id}/complete`).send({}).expect(200);
    await owner.patch(`/api/sprints/${sprint.id}`).send({ goal: 'x' }).expect(400);
    const item = await create({ title: 'late' });
    await owner.patch(`/api/tasks/${item.id}`).send({ sprintId: sprint.id }).expect(400);
  });

  it('only planned sprints can be deleted, releasing their items', async () => {
    const planned = await newSprint();
    const item = await create({ title: 'x' });
    await owner.patch(`/api/tasks/${item.id}`).send({ sprintId: planned.id }).expect(200);
    await owner.delete(`/api/sprints/${planned.id}`).expect(204);
    expect((await owner.get(`/api/tasks/${item.id}`).expect(200)).body.sprintId).toBeNull();

    const active = await newSprint('Active');
    await owner.post(`/api/sprints/${active.id}/start`).expect(200);
    await owner.delete(`/api/sprints/${active.id}`).expect(400);
  });

  it('produces a burndown of remaining story points', async () => {
    const sprint = await newSprint();
    await owner.post(`/api/sprints/${sprint.id}/start`).expect(200);
    const a = await create({ title: 'A', storyPoints: 5, columnId: columnId(project, 'todo') });
    await create({ title: 'B', storyPoints: 3, columnId: columnId(project, 'todo') });
    await owner.post(`/api/tasks/${a.id}/move`).send({ columnId: columnId(project, 'done'), index: 0 }).expect(200);
    const burndown = (await owner.get(`/api/sprints/${sprint.id}/burndown`).expect(200)).body.items as Array<{ remainingPoints: number }>;
    expect(burndown[0]!.remainingPoints).toBe(8);
    expect(burndown.at(-1)!.remainingPoints).toBe(3);
  });

  it('updates sprint name and goal', async () => {
    const sprint = await newSprint();
    const res = await owner.patch(`/api/sprints/${sprint.id}`).send({ name: 'Renamed', goal: 'New goal' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Renamed', goal: 'New goal' });
  });
});
