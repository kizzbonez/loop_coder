import { describe, expect, it } from 'vitest';
import type { ActivityDTO, ColumnKind, PresenceEntryDTO, RemarkDTO, ReplayDTO, TaskDTO } from '@loop/shared';
import { alignPresence, buildReplayModel, countUpTo, presenceAt, presenceChanges, SEGMENT_ID } from './timeline';

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 0, 1, 10, minute, second)).toISOString();
const ms = (minute: number, second = 0) => Date.parse(at(minute, second));
const WINDOW = 10 * 60_000;

let seq = 0;
const activity = (over: Partial<ActivityDTO>): ActivityDTO => ({
  id: `a${++seq}`,
  projectId: 'p',
  taskId: null,
  taskKey: null,
  actorType: 'agent',
  actorUserId: 'u',
  actorName: 'Claude Code',
  roleKey: null,
  action: 'task.moved',
  message: '',
  fromKind: null,
  toKind: null,
  ceremony: null,
  createdAt: at(0),
  ...over,
});
const row = (minute: number, over: Partial<PresenceEntryDTO> = {}): PresenceEntryDTO => ({
  sessionId: 's1',
  agentName: 'Claude Code',
  userName: 'Ada',
  at: at(minute),
  taskId: null,
  taskKey: null,
  roleKey: 'project_manager',
  ceremony: null,
  activity: null,
  ...over,
});

describe('countUpTo', () => {
  it('counts sorted times up to and including t', () => {
    expect(countUpTo([], 5)).toBe(0);
    expect(countUpTo([1, 2, 2, 3], 2)).toBe(3);
    expect(countUpTo([1, 2, 3], 0)).toBe(0);
    expect(countUpTo([1, 2, 3], 9)).toBe(3);
  });
});

describe('segment ids', () => {
  it('tells segments from work item ids', () => {
    for (const id of ['all', 'kickoff', 'latest', 'sprint-1', 'sprint-12']) expect(SEGMENT_ID.test(id), id).toBe(true);
    for (const id of ['t1', 'sprint-', 'sprint-x', '3f2a9c1e-0000-4000-8000-000000000000', 'all-of-it']) expect(SEGMENT_ID.test(id), id).toBe(false);
  });
});

describe('presenceAt', () => {
  const entries = [
    row(0, { ceremony: 'kickoff' }),
    row(5, { sessionId: 's2', agentName: 'Cursor', roleKey: 'senior_developer', taskId: 't1', taskKey: 'SHOP-1' }),
    row(8, { ceremony: null, activity: 'Completed the project kickoff' }),
  ];
  const times = entries.map((e) => Date.parse(e.at));

  it('shows the latest row of each session, like the live view', () => {
    expect(presenceAt(entries, times, ms(0) - 1, WINDOW)).toEqual([]);
    expect(presenceAt(entries, times, ms(1), WINDOW).map((a) => [a.agentName, a.currentCeremony])).toEqual([['Claude Code', 'kickoff']]);
    const later = presenceAt(entries, times, ms(9), WINDOW);
    expect(later.map((a) => a.agentName)).toEqual(['Claude Code', 'Cursor']); // stable order by session
    expect(later[0]).toMatchObject({ currentCeremony: null, currentActivity: 'Completed the project kickoff', lastSeenAt: at(8) });
    expect(later[1]).toMatchObject({ currentTaskId: 't1', currentTaskKey: 'SHOP-1', currentRoleKey: 'senior_developer' });
  });

  it('lets an agent go offline after the online window without news', () => {
    expect(presenceAt(entries, times, ms(15), WINDOW).map((a) => a.agentName)).toEqual(['Claude Code', 'Cursor']);
    expect(presenceAt(entries, times, ms(15) + 1, WINDOW).map((a) => a.agentName)).toEqual(['Claude Code']); // Cursor last seen at 10:05
    expect(presenceAt(entries, times, ms(18) + 1, WINDOW)).toEqual([]);
  });
});

describe('alignPresence', () => {
  it('puts a row on the time of the action its request made, and keeps heartbeats where they are', () => {
    const actions = [
      { at: ms(1), name: 'Claude Code' },
      { at: ms(2), name: 'Cursor' },
    ];
    const entries = [
      row(1, { at: new Date(ms(1) + 7).toISOString() }), // written 7 ms after its action
      row(2, { sessionId: 's2', agentName: 'Cursor', at: new Date(ms(2) + 5).toISOString() }),
      row(3), // a heartbeat: nothing done at 10:03
      row(4, { agentName: 'Claude Code', at: new Date(ms(2) + 900).toISOString() }), // close to Cursor\x27s action, not its own
    ];
    const { entries: sorted, times } = alignPresence(entries, actions);
    expect(times).toEqual([ms(1), ms(2), ms(2) + 900, ms(3)]);
    expect(sorted.map((e) => e.agentName)).toEqual(['Claude Code', 'Cursor', 'Claude Code', 'Claude Code']);
  });
});

describe('presenceChanges', () => {
  it('marks when what an agent shows changes and when it goes offline, not every heartbeat', () => {
    const entries = [row(0, { activity: 'A' }), row(1, { activity: 'A' }), row(2, { activity: 'B' }), row(30, { activity: 'B' })];
    const marks = presenceChanges(entries, entries.map((e) => Date.parse(e.at)), WINDOW);
    // 10:00 first seen, 10:02 changed, 10:12 offline (no news), 10:30 back, 10:40 offline again.
    expect(marks.sort((a, b) => a - b)).toEqual([ms(0), ms(2), ms(12), ms(30), ms(40)]);
  });
});

describe('buildReplayModel', () => {
  const columnKindOf = (id: string) => id.replace('c-', '') as ColumnKind;
  // Today SHOP-1 is done. Earlier: created in the backlog at 10:01, planned at 10:20, worked from 10:30.
  const tasks = [{ id: 't1', type: 'story', columnId: 'c-done' }] as unknown as TaskDTO[];
  const events = [
    activity({ action: 'ceremony.started', ceremony: 'kickoff', createdAt: at(0, 30), roleKey: 'project_manager' }),
    activity({ action: 'task.created', taskId: 't1', taskKey: 'SHOP-1', toKind: 'backlog', createdAt: at(1), roleKey: 'project_manager' }),
    activity({ action: 'project.kickoff_completed', createdAt: at(2), roleKey: 'project_manager' }),
    activity({ action: 'agent.progress', message: 'Thinking about the plan', createdAt: at(10) }),
    activity({ action: 'task.moved', taskId: 't1', taskKey: 'SHOP-1', fromKind: 'backlog', toKind: 'todo', createdAt: at(20) }),
    activity({ action: 'task.moved', taskId: 't1', taskKey: 'SHOP-1', fromKind: 'todo', toKind: 'in_progress', createdAt: at(30), roleKey: 'senior_developer' }),
    activity({ action: 'task.moved', taskId: 't1', taskKey: 'SHOP-1', fromKind: 'in_progress', toKind: 'done', createdAt: at(50), roleKey: 'senior_developer' }),
  ].reverse(); // newest first, as the API returns them
  const remark = { id: 'r1', taskId: 't1', projectId: 'p', authorType: 'agent', authorUserId: 'u', authorName: 'Claude Code', roleKey: 'senior_developer', kind: 'work_log', body: 'Built it', createdAt: at(40) } as RemarkDTO;
  const data = (over: Partial<ReplayDTO>): ReplayDTO => ({
    segments: [],
    segment: { id: 'sprint-1', label: 'Sprint 1', detail: null, from: at(2), to: at(55) },
    events: events.filter((e) => e.createdAt >= at(2)),
    remarks: [remark],
    presence: [],
    presenceSince: null,
    onlineWindowMinutes: 10,
    truncated: false,
    ...over,
  });
  const now = { kickoffDone: true, sprintActive: false };

  it('starts the segment with the board as it was then', () => {
    const model = buildReplayModel(data({}), tasks, columnKindOf, now, ms(59));
    expect([model.start, model.end]).toEqual([ms(2), ms(55)]);
    expect(model.frame(ms(2)).snapshot.stageOf.get('t1')).toBe('backlog');
    expect(model.frame(ms(25)).snapshot.stageOf.get('t1')).toBe('todo');
    expect(model.frame(ms(55)).snapshot.stageOf.get('t1')).toBe('done');
  });

  it('marks every moment something happened inside the segment, and keeps what is said', () => {
    const model = buildReplayModel(data({}), tasks, columnKindOf, now, ms(59));
    expect(model.marks).toEqual([ms(2), ms(10), ms(20), ms(30), ms(40), ms(50)]);
    expect(model.events.map((e) => e.action)).toEqual(['project.kickoff_completed', 'agent.progress', 'task.moved', 'task.moved', 'task.moved']);
    expect(model.remarks).toEqual([remark]);
  });

  it('infers agents from their actions before the presence log, going offline after the window', () => {
    const model = buildReplayModel(data({}), tasks, columnKindOf, now, ms(59));
    const frame = model.frame(ms(31));
    expect(frame.exact).toBe(false);
    expect(frame.agents).toEqual([expect.objectContaining({ name: 'Claude Code', stage: 'in_progress', roleKey: 'senior_developer', taskKey: 'SHOP-1', working: true })]);
    // A remark at 10:40 keeps the agent around until 10:50; then the move to Done.
    expect(model.frame(ms(49)).agents).toHaveLength(1);
    expect(model.frame(ms(50)).agents[0]).toMatchObject({ stage: 'done' });
    // The progress note at 10:10 counts as being seen; nothing between 10:20 and 10:30 is fine too.
    expect(model.frame(ms(19)).agents).toHaveLength(1);
  });

  it('uses the presence log where it exists, exactly as recorded', () => {
    const presence = [
      row(28, { roleKey: 'senior_developer', taskId: 't1', taskKey: 'SHOP-1', activity: 'Working on SHOP-1 as Senior Developer' }),
      row(45, { roleKey: 'project_manager', ceremony: 'sprint_review', activity: 'Sprint review as Project Manager' }),
    ];
    const model = buildReplayModel(data({ presence, presenceSince: at(28) }), tasks, columnKindOf, now, ms(59));
    expect(model.frame(ms(27)).exact).toBe(false);
    const working = model.frame(ms(31));
    expect(working.exact).toBe(true);
    expect(working.agents).toEqual([
      expect.objectContaining({ id: 's1', stage: 'in_progress', roleKey: 'senior_developer', taskKey: 'SHOP-1', activity: 'Working on SHOP-1 as Senior Developer', working: true }),
    ]);
    // A ceremony from the log sets the phase.
    const review = model.frame(ms(46));
    expect(review.agents[0]).toMatchObject({ stage: 'sprint_review', working: true });
    expect(review.phase).toBe('sprint_review');
    // Moments after the presence log ends: the agent is gone once the window passes.
    expect(model.frame(ms(55)).agents).toHaveLength(1);
    expect(buildReplayModel(data({ presence, presenceSince: at(28), segment: { id: 'all', label: '', detail: null, from: at(2), to: at(59) } }), tasks, columnKindOf, now, ms(59)).frame(ms(56)).agents).toHaveLength(0);
  });

  it('ends a segment that is still going on at the moment it was loaded', () => {
    const model = buildReplayModel(data({ segment: { id: 'latest', label: '', detail: null, from: at(2), to: null } }), tasks, columnKindOf, now, ms(58));
    expect(model.end).toBe(ms(58));
  });
});
