import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { ActivityDTO, OnlineAgentDTO, ProjectDetailDTO } from '@loop/shared';
import { FLOW_ACTIONS } from '@loop/shared';
import { createProject, createToken, createUser, freshApp, mcpClient, setupAdmin, type Agent } from '../helpers';

let app: Express;
let human: Agent;
let projectId: string;

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  human = admin.agent;
  projectId = (await createProject(human, admin.workspaceId)).id;
});

const P = { project: 'SHOP' };
const detail = async () => (await human.get(`/api/projects/${projectId}`).expect(200)).body as ProjectDetailDTO;
const flowActivity = async (query = '') =>
  (await human.get(`/api/projects/${projectId}/activity?kind=flow${query}`).expect(200)).body.items as ActivityDTO[];

describe('Flow view data', () => {
  it('tracks the ceremony an agent is running and records when it starts', async () => {
    const claude = mcpClient(app, await createToken(human));
    await claude.initialize('claude-code');
    await claude.ok('get_next_work', P); // kickoff

    const during = await detail();
    expect(during.agent.currentCeremony).toBe('kickoff');
    expect(during.agents).toHaveLength(1);
    expect(during.agents[0]).toMatchObject({ agentName: 'Claude Code', currentCeremony: 'kickoff', currentRoleKey: 'project_manager', currentTaskId: null });

    // Asking again while still running the kickoff does not log a second start.
    await claude.ok('get_next_work', P);
    let started = (await flowActivity()).filter((a) => a.action === 'ceremony.started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ ceremony: 'kickoff', message: 'Claude Code (Project Manager) started the project kickoff' });

    await claude.ok('create_work_items', { ...P, items: [{ title: 'Search', story_points: 3, acceptance_criteria: '- Finds items' }] });
    await claude.ok('complete_kickoff', { ...P, summary: 'ok' });
    expect((await detail()).agents[0]!.currentCeremony).toBeNull();
    expect((await detail()).kickoffCompletedAt).not.toBeNull();

    await claude.ok('get_next_work', P); // refinement of SHOP-1
    await claude.ok('mark_refined', { item: 'SHOP-1', summary: 'ready' });
    await claude.ok('get_next_work', P); // sprint planning
    expect((await detail()).agents[0]!.currentCeremony).toBe('sprint_planning');
    started = (await flowActivity()).filter((a) => a.action === 'ceremony.started');
    expect(started.map((a) => a.message)).toContain('Claude Code (Project Manager) started sprint planning');
  });

  it('lists every online agent with its own work', async () => {
    const claude = mcpClient(app, await createToken(human));
    const cursor = mcpClient(app, await createToken(human));
    await claude.initialize('claude-code');
    await cursor.initialize('cursor-vscode');
    await claude.ok('get_next_work', P);
    await claude.ok('create_work_items', { ...P, items: [{ title: 'A' }, { title: 'B' }] });
    await claude.ok('complete_kickoff', { ...P, summary: 'ok' });
    await claude.ok('get_next_work', P); // SHOP-1
    await cursor.ok('get_next_work', P); // SHOP-2

    const agents = (await detail()).agents as OnlineAgentDTO[];
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.agentName).sort()).toEqual(['Claude Code', 'Cursor']);
    expect(agents.find((a) => a.agentName === 'Claude Code')).toMatchObject({ currentTaskKey: 'SHOP-1', currentRoleKey: 'project_manager' });
    expect(agents.find((a) => a.agentName === 'Cursor')).toMatchObject({ currentTaskKey: 'SHOP-2', currentRoleKey: 'project_manager' });
    expect(new Set(agents.map((a) => a.id)).size).toBe(2);
  });

  it('exposes the stages of every move and of newly created items', async () => {
    const claude = mcpClient(app, await createToken(human));
    await claude.initialize('claude-code');
    await claude.ok('get_next_work', P);
    await claude.ok('create_work_items', { ...P, items: [{ title: 'Checkout', story_points: 5, acceptance_criteria: '- Pays' }] });
    await claude.ok('complete_kickoff', { ...P, summary: 'ok' });
    await claude.ok('get_next_work', P);
    await claude.ok('mark_refined', { item: 'SHOP-1', summary: 'ready' });
    await claude.ok('get_next_work', P); // planning
    await claude.ok('start_sprint', { ...P, goal: 'Checkout', items: ['SHOP-1'] });
    await claude.ok('get_next_work', P); // SHOP-1: To Do → In Progress
    await claude.ok('move_work_item', { item: 'SHOP-1', to: 'review', remark: 'Built it' });

    const flow = await flowActivity();
    const created = flow.find((a) => a.action === 'task.created')!;
    expect(created).toMatchObject({ taskKey: 'SHOP-1', fromKind: null, toKind: 'backlog' });
    const moves = flow.filter((a) => a.action === 'task.moved').map((a) => [a.fromKind, a.toKind]);
    expect(moves).toEqual(
      expect.arrayContaining([
        ['backlog', 'todo'],
        ['todo', 'in_progress'],
        ['in_progress', 'review'],
      ]),
    );
    // Only flow events, newest first.
    for (const a of flow) expect(FLOW_ACTIONS).toContain(a.action);
    const all = (await human.get(`/api/projects/${projectId}/activity?limit=200`).expect(200)).body.items as ActivityDTO[];
    expect(all.some((a) => !(FLOW_ACTIONS as readonly string[]).includes(a.action))).toBe(true);
    for (const a of all.filter((x) => !(FLOW_ACTIONS as readonly string[]).includes(x.action))) expect(a).toMatchObject({ fromKind: null, toKind: null, ceremony: null });
    const times = flow.map((a) => Date.parse(a.createdAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it('allows longer flow histories but still caps the limit', async () => {
    await human.get(`/api/projects/${projectId}/activity?kind=flow&limit=1000`).expect(200);
    await human.get(`/api/projects/${projectId}/activity?kind=flow&limit=99999`).expect(200);
    await human.get(`/api/projects/${projectId}/activity?kind=other&limit=5000`).expect(200);
  });

  it('keeps flow history private to project members', async () => {
    const stranger = await createUser(app, human, 'stranger@example.com');
    await stranger.agent.get(`/api/projects/${projectId}/activity?kind=flow`).expect(404);
  });
});
