import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { ProjectDetailDTO, ReplayDTO } from '@loop/shared';
import { PRESENCE_HEARTBEAT_MS } from '../../src/modules/presence/presence.service';
import { REPLAY_LIMITS } from '../../src/modules/replay/replay.service';
import { createProject, createToken, createUser, freshApp, mcpClient, setupAdmin, type Agent } from '../helpers';

let app: Express;
let human: Agent;
let workspaceId: string;
let projectId: string;

beforeEach(async () => {
  app = freshApp();
  const admin = await setupAdmin(app);
  human = admin.agent;
  workspaceId = admin.workspaceId;
  projectId = (await createProject(human, workspaceId)).id;
});
afterEach(() => vi.useRealTimers());

const P = { project: 'SHOP' };
const replay = async (segment?: string) =>
  (await human.get(`/api/projects/${projectId}/replay${segment ? `?segment=${segment}` : ''}`).expect(200)).body as ReplayDTO;
const detail = async () => (await human.get(`/api/projects/${projectId}`).expect(200)).body as ProjectDetailDTO;

/** Kickoff with one ready item, a sprint started and worked: the usual start of a project. */
async function kickoffAndSprint() {
  const claude = mcpClient(app, await createToken(human));
  await claude.initialize('claude-code');
  await claude.ok('get_next_work', P); // kickoff
  await claude.ok('create_work_items', { ...P, items: [{ title: 'Search', story_points: 3, acceptance_criteria: '- Finds items', refined: true }] });
  await claude.ok('complete_kickoff', { ...P, summary: 'ok' });
  await claude.ok('get_next_work', P); // sprint planning
  await claude.ok('start_sprint', { ...P, goal: 'Shoppers can search', items: ['SHOP-1'] });
  await claude.ok('get_next_work', P); // SHOP-1 as engineer
  await claude.ok('add_remark', { item: 'SHOP-1', kind: 'work_log', body: `Built the search. ${'x'.repeat(REPLAY_LIMITS.remarkChars + 50)}` });
  return claude;
}

describe('presence log', () => {
  it('records what the agent shows, in order, with names copied in', async () => {
    await kickoffAndSprint();
    const { presence } = await replay();
    expect(presence.length).toBeGreaterThanOrEqual(5);
    expect(presence[0]).toMatchObject({ agentName: 'Claude Code', userName: 'Ada Admin', ceremony: 'kickoff', roleKey: 'project_manager', taskId: null });
    const activities = presence.map((p) => p.activity);
    expect(activities).toContain('Completed the project kickoff');
    const working = presence.find((p) => p.taskKey === 'SHOP-1' && p.ceremony === null);
    expect(working).toMatchObject({ roleKey: 'senior_developer', activity: 'Working on SHOP-1 as Senior Developer' });
    expect(new Set(presence.map((p) => p.sessionId)).size).toBe(1);
    // Oldest first.
    expect([...presence].sort((a, b) => a.at.localeCompare(b.at))).toEqual(presence);
  });

  it('adds a heartbeat only when nothing changed for a while', async () => {
    // Start just after the project was created (the replay window begins there).
    const start = Date.now() + 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(start));
    const claude = mcpClient(app, await createToken(human));
    await claude.initialize('claude-code');
    await claude.ok('get_next_work', P); // kickoff
    const count = async () => (await replay()).presence.length;
    const first = await count();
    // Reading does not change what the agent shows: no new rows within the heartbeat period.
    vi.setSystemTime(new Date(start + PRESENCE_HEARTBEAT_MS - 1000));
    await claude.ok('get_next_work', P);
    expect(await count()).toBe(first);
    // After it, the same state is logged again so the replay knows the agent was still there.
    vi.setSystemTime(new Date(start + PRESENCE_HEARTBEAT_MS + 1000));
    await claude.ok('get_next_work', P);
    expect(await count()).toBe(first + 1);
  });

  it('is not written for people, only for agents', async () => {
    await human.get(`/api/projects/${projectId}`).expect(200);
    expect((await replay()).presence).toEqual([]);
    expect((await replay()).presenceSince).toBeNull();
  });
});

describe('replay segments', () => {
  it('splits the history into kickoff and sprints that follow each other', async () => {
    const before = await replay();
    expect(before.segments.map((s) => s.id)).toEqual(['all', 'kickoff']);
    expect(before.segments[1]!.to).toBeNull(); // kickoff still going on

    await kickoffAndSprint();
    let segments = (await replay()).segments;
    expect(segments.map((s) => s.id)).toEqual(['all', 'kickoff', 'sprint-1']);
    const [, kickoff, sprint] = segments;
    expect(kickoff!.to).toBe((await detail()).kickoffCompletedAt);
    expect(sprint).toMatchObject({ label: 'Sprint 1', detail: 'Shoppers can search', from: kickoff!.to, to: null });

    // Complete the sprint, then refine something: the time since is its own segment.
    const sprintId = (await detail()).activeSprint!.id;
    await human.post(`/api/sprints/${sprintId}/complete`).send({ reviewNotes: 'ok', retroNotes: 'ok' }).expect(200);
    segments = (await replay()).segments;
    expect(segments.find((s) => s.id === 'sprint-1')!.to).not.toBeNull();
    const claude = mcpClient(app, await createToken(human));
    await claude.initialize('claude-code');
    await claude.ok('create_work_items', { ...P, items: [{ title: 'Wishlist' }] });
    segments = (await replay()).segments;
    expect(segments.at(-1)).toMatchObject({ id: 'latest', label: 'Since Sprint 1', from: segments.find((s) => s.id === 'sprint-1')!.to, to: null });
  });

  it('returns the data of one segment: events until now, remarks and presence inside it', async () => {
    await kickoffAndSprint();
    const all = await replay('all');
    const kickoff = await replay('kickoff');
    const sprint = await replay('sprint-1');
    expect(kickoff.segment.id).toBe('kickoff');
    expect(sprint.segment.id).toBe('sprint-1');

    // Events: from the segment start to now (later moves rebuild the board at its start), newest first.
    expect(sprint.events.every((e) => e.createdAt >= sprint.segment.from)).toBe(true);
    expect(kickoff.events.length).toBe(all.events.length);
    expect(sprint.events.length).toBeLessThan(all.events.length);
    expect([...sprint.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))).toEqual(sprint.events);

    // Remarks and presence stay inside the segment.
    expect(kickoff.remarks).toEqual([]);
    expect(sprint.remarks).toHaveLength(1);
    expect(sprint.remarks[0]!.body.length).toBe(REPLAY_LIMITS.remarkChars + 1); // shortened, with an ellipsis
    expect(sprint.remarks[0]!.body.endsWith('…')).toBe(true);
    expect(kickoff.presence.every((p) => !kickoff.segment.to || p.at <= kickoff.segment.to)).toBe(true);
    expect(sprint.presence.some((p) => p.taskKey === 'SHOP-1')).toBe(true);
    expect(sprint.onlineWindowMinutes).toBe(10);
    expect(sprint.truncated).toBe(false);
    // An unknown segment falls back to the whole project.
    expect((await replay('sprint-99')).segment.id).toBe('all');
  });

  it('is only for project members', async () => {
    const { agent: stranger } = await createUser(app, human, 'eve@example.com');
    await stranger.get(`/api/projects/${projectId}/replay`).expect((res) => expect([403, 404]).toContain(res.status));
  });
});
