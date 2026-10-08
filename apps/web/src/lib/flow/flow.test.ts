import { describe, expect, it } from 'vitest';
import type { ActivityDTO, AgentRoleDTO, ColumnDTO, ColumnKind, OnlineAgentDTO, TaskDTO } from '@loop/shared';
import { bendFor, center, edgeGeometry, geometryFor, layoutFlow, samplePoints, VERTICAL_BELOW, type Rect } from './layout';
import { buildStages, classifyMove, currentPhase, placeAgents, routeFor, STATIC_EDGES, transitionCounts, type StageId } from './model';
import { buildTimeline, createReplay, journeyOf, lastStages, snapshotPhase, snapshots, stageCounts } from './replay';

const KINDS: ColumnKind[] = ['backlog', 'todo', 'in_progress', 'review', 'testing', 'blocked', 'done'];
const columns: ColumnDTO[] = KINDS.map((kind, i) => ({
  id: `c-${kind}`,
  projectId: 'p',
  key: kind,
  name: kind === 'blocked' ? 'Needs Human' : kind,
  kind,
  position: i,
  agentRoleId: kind === 'in_progress' ? null : `r-${kind}`,
  roleSource: kind === 'in_progress' || kind === 'todo' ? 'task' : 'column',
  wipLimit: kind === 'in_progress' ? 3 : null,
  color: null,
}));
const kindOfColumn = (id: string) => columns.find((c) => c.id === id)?.kind;
const roles: AgentRoleDTO[] = [
  { id: 'r-backlog', key: 'project_manager', name: 'Project Manager', description: '', instructions: '', color: '#6d4aff', isSystem: true, enabled: true, assignable: false },
  { id: 'r-review', key: 'code_reviewer', name: 'Code Reviewer', description: '', instructions: '', color: '#f59e0b', isSystem: true, enabled: true, assignable: false },
];

let n = 0;
function task(id: string, kind: ColumnKind, extra: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id,
    projectId: 'p',
    key: `P-${++n}`,
    number: n,
    type: 'story',
    title: id,
    description: '',
    acceptanceCriteria: '',
    priority: 'medium',
    storyPoints: 3,
    columnId: `c-${kind}`,
    position: n,
    parentId: null,
    sprintId: null,
    assignedRoleId: null,
    assigneeUserId: null,
    labels: [],
    refined: true,
    bounceCount: 0,
    dependsOn: [],
    claim: null,
    createdByAgent: true,
    remarkCount: 0,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

let t = 0;
function act(action: string, extra: Partial<ActivityDTO> = {}): ActivityDTO {
  return {
    id: `a${++t}`,
    projectId: 'p',
    taskId: null,
    taskKey: null,
    actorType: 'agent',
    actorUserId: 'u',
    actorName: 'Claude Code',
    roleKey: null,
    action,
    message: action,
    fromKind: null,
    toKind: null,
    ceremony: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, t)).toISOString(),
    ...extra,
  };
}

const agent = (over: Partial<OnlineAgentDTO>): OnlineAgentDTO => ({
  id: 's1',
  agentName: 'Claude Code',
  clientName: 'claude-code 2.1',
  userName: 'Ada',
  lastSeenAt: '2026-01-01T00:00:00Z',
  currentTaskId: null,
  currentTaskKey: null,
  currentRoleKey: null,
  currentCeremony: null,
  currentActivity: null,
  ...over,
});

describe('flow model', () => {
  it('builds a stage per column plus the ceremonies and the lounge', () => {
    const tasks = [task('a', 'backlog'), task('b', 'in_progress', { storyPoints: 5 }), task('e', 'in_progress', { type: 'epic' })];
    const stages = buildStages(columns, tasks, roles);
    expect([...stages.keys()]).toEqual([...KINDS, 'kickoff', 'sprint_planning', 'sprint_review', 'lounge']);
    expect(stages.get('in_progress')).toMatchObject({ roleFromItems: true, wipLimit: 3, points: 5 });
    expect(stages.get('in_progress')!.tasks.map((x) => x.id)).toEqual(['b']); // epics are not work items
    expect(stages.get('blocked')!.label).toBe('Needs Human');
    expect(stages.get('sprint_planning')).toMatchObject({ type: 'ceremony', label: 'Sprint planning', role: roles[0] });
  });

  it('classifies moves', () => {
    expect(classifyMove('in_progress', 'review')).toBe('forward');
    expect(classifyMove('review', 'in_progress')).toBe('rework');
    expect(classifyMove('testing', 'blocked')).toBe('escalate');
    expect(classifyMove('blocked', 'testing')).toBe('resolve');
    expect(classifyMove('done', 'backlog')).toBe('reopen');
    expect(classifyMove(null, 'backlog')).toBe('other');
  });

  it('routes sprint commitments through planning and invents edges for other jumps', () => {
    expect(routeFor('backlog', 'todo').map((e) => e.id)).toEqual(['backlog->sprint_planning', 'sprint_planning->todo']);
    expect(routeFor('review', 'in_progress')[0]).toMatchObject({ kind: 'rework', label: 'changes requested' });
    expect(routeFor('todo', 'done')).toEqual([{ id: 'todo->done', from: 'todo', to: 'done', kind: 'forward', label: undefined }]);
    expect(routeFor('review', 'review')).toEqual([]);
  });

  it('places agents at their ceremony, at their item, at their last stage, or in the lounge', () => {
    const stageOfTask = (id: string) => (id === 'b' ? ('review' as const) : undefined);
    const placed = placeAgents(
      [
        agent({ id: '1', currentCeremony: 'sprint_planning' }),
        agent({ id: '2', agentName: 'Cursor', currentTaskId: 'b', currentTaskKey: 'P-2' }),
        agent({ id: '3', agentName: 'Codex' }),
        agent({ id: '4', agentName: 'Copilot' }),
      ],
      stageOfTask,
      new Map<string, StageId>([['Codex', 'testing']]),
    );
    expect(placed.map((a) => [a.name, a.stage, a.working])).toEqual([
      ['Claude Code', 'sprint_planning', true],
      ['Cursor', 'review', true],
      ['Codex', 'testing', false],
      ['Copilot', 'lounge', false],
    ]);
  });

  it('knows the Scrum phase', () => {
    expect(currentPhase({ kickoffCompletedAt: null, activeSprint: null }, [])).toBe('kickoff');
    expect(currentPhase({ kickoffCompletedAt: 'x', activeSprint: null }, [])).toBe('sprint_planning');
    expect(currentPhase({ kickoffCompletedAt: 'x', activeSprint: {} as never }, [])).toBe('sprint');
    expect(currentPhase({ kickoffCompletedAt: 'x', activeSprint: {} as never }, [{ stage: 'sprint_review', working: true }])).toBe('sprint_review');
  });

  it('counts the paths work took', () => {
    const counts = transitionCounts([
      act('task.moved', { fromKind: 'review', toKind: 'in_progress' }),
      act('task.moved', { fromKind: 'review', toKind: 'in_progress' }),
      act('task.moved', { fromKind: 'backlog', toKind: 'todo' }),
      act('task.created', { toKind: 'backlog' }),
    ]);
    expect(counts.get('review->in_progress')).toBe(2);
    expect(counts.get('backlog->sprint_planning')).toBe(1);
    expect(counts.get('sprint_planning->todo')).toBe(1);
  });
});

describe('flow replay', () => {
  it('undoes moves to find the starting board and replays them forward', () => {
    const a = task('a', 'review');
    const b = task('b', 'todo');
    const history = [
      act('sprint.started', { actorType: 'user', actorName: 'Ada' }),
      act('task.created', { taskId: 'b', toKind: 'backlog' }),
      act('task.moved', { taskId: 'a', fromKind: 'todo', toKind: 'in_progress' }),
      act('task.started', { taskId: 'a', roleKey: 'senior_developer' }),
      act('task.moved', { taskId: 'a', fromKind: 'in_progress', toKind: 'review' }),
      act('task.moved', { taskId: 'b', fromKind: 'backlog', toKind: 'todo', actorType: 'user', actorName: 'Ada' }),
      act('agent.progress'), // not a flow event
    ].reverse(); // the API returns newest first
    const timeline = buildTimeline(history);
    expect(timeline).toHaveLength(6);
    const snaps = snapshots(timeline, [a, b], kindOfColumn);
    expect(snaps).toHaveLength(7);
    expect(Object.fromEntries(snaps[0]!.stageOf)).toEqual({ a: 'todo' }); // b did not exist yet
    expect(Object.fromEntries(snaps[2]!.stageOf)).toEqual({ a: 'todo', b: 'backlog' });
    expect(snaps[4]!.agents.get('Claude Code')).toMatchObject({ stage: 'in_progress', roleKey: 'senior_developer' });
    expect(snaps[5]!.agents.get('Claude Code')!.stage).toBe('review');
    expect(Object.fromEntries(snaps[6]!.stageOf)).toEqual({ a: 'review', b: 'todo' }); // matches today
    expect(snaps[6]!.agents.has('Ada')).toBe(false); // people are not agents
    expect(Object.fromEntries(stageCounts(snaps[6]!))).toEqual({ review: 1, todo: 1 });
  });

  it('follows ceremonies and keeps agents in them while they create items', () => {
    const timeline = buildTimeline(
      [
        act('ceremony.started', { ceremony: 'kickoff', roleKey: 'project_manager' }),
        act('task.created', { taskId: 'x', toKind: 'backlog' }),
        act('project.kickoff_completed'),
        act('ceremony.started', { ceremony: 'sprint_planning' }),
      ].reverse(),
    );
    const snaps = snapshots(timeline, [task('x', 'backlog')], kindOfColumn);
    expect(snaps[1]!.ceremony).toBe('kickoff');
    expect(snaps[2]!.agents.get('Claude Code')!.stage).toBe('kickoff');
    expect(snaps[3]!.ceremony).toBeNull();
    expect(snaps[3]!.agents.get('Claude Code')!.stage).toBe('backlog');
    expect(snaps[4]!.ceremony).toBe('sprint_planning');
    expect(lastStages(timeline).get('Claude Code')).toBe('sprint_planning');
  });

  it('ignores epics and deleted items', () => {
    const timeline = buildTimeline([
      act('task.moved', { taskId: 'epic', fromKind: 'backlog', toKind: 'done', actorType: 'system', actorName: null }),
      act('task.moved', { taskId: 'gone', fromKind: 'todo', toKind: 'in_progress' }),
    ]);
    const snaps = snapshots(timeline, [task('epic', 'done', { type: 'epic' })], kindOfColumn);
    expect(snaps.every((s) => s.stageOf.size === 0)).toBe(true);
  });
});

describe('flow layout', () => {
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const within = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

  for (const width of [320, 390, 768, VERTICAL_BELOW, 1024, 1440, 1920]) {
    it(`places every stage without overlaps at ${width}px`, () => {
      const layout = layoutFlow(width);
      expect(layout.orientation).toBe(width < VERTICAL_BELOW ? 'vertical' : 'horizontal');
      const rects = Object.entries(layout.rects);
      expect(rects).toHaveLength(11);
      for (const [id, r] of rects) expect(within(r, layout.width, layout.height), id).toBe(true);
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]![1], rects[j]![1]), `${rects[i]![0]} / ${rects[j]![0]}`).toBe(false);
    });

    it(`keeps every drawn path inside the canvas and off other stages at ${width}px`, () => {
      const layout = layoutFlow(width);
      for (const e of STATIC_EDGES) {
        const g = geometryFor(e, layout);
        for (const p of samplePoints([g], 24)) {
          expect(p.x, e.id).toBeGreaterThanOrEqual(-1);
          expect(p.x, e.id).toBeLessThanOrEqual(layout.width + 1);
          expect(p.y, e.id).toBeGreaterThanOrEqual(-1);
          expect(p.y, e.id).toBeLessThanOrEqual(layout.height + 1);
        }
        // Inner points of a path never pass through a stage other than its two ends.
        const inner = samplePoints([g], 40).slice(4, -4);
        for (const [id, r] of Object.entries(layout.rects)) {
          if (id === e.from || id === e.to) continue;
          for (const p of inner) expect(p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h, `${e.id} crosses ${id}`).toBe(false);
        }
      }
    });
  }

  it('starts and ends paths at the edges of the stages', () => {
    const a = { x: 0, y: 0, w: 100, h: 50 };
    const b = { x: 300, y: 0, w: 100, h: 50 };
    const g = edgeGeometry(a, b, 0);
    expect(g.start).toEqual({ x: 106, y: 25 });
    expect(g.end).toEqual({ x: 294, y: 25 });
    expect(g.d).toBe('M 106 25 Q 200 25 294 25');
    expect(g.mid).toEqual({ x: 200, y: 25 });
  });

  it('bends rework below the pipeline and the sprint loop above it', () => {
    const layout = layoutFlow(1440);
    const rework = geometryFor(STATIC_EDGES.find((e) => e.id === 'review->in_progress')!, layout);
    expect(rework.mid.y).toBeGreaterThan(center(layout.rects.review).y + layout.rects.review.h / 2);
    const loop = geometryFor(STATIC_EDGES.find((e) => e.kind === 'loop')!, layout);
    expect(loop.mid.y).toBeLessThan(layout.rects.sprint_planning.y);
    expect(bendFor({ from: 'todo', to: 'in_progress', kind: 'forward' }, layout)).toBe(0);
  });

  it('samples a route across several edges without repeating joints', () => {
    const layout = layoutFlow(1440);
    const route = routeFor('backlog', 'todo').map((e) => geometryFor(e, layout));
    const points = samplePoints(route, 10);
    expect(points).toHaveLength(21);
    expect(points[0]).toEqual(route[0]!.start);
    expect(points.at(-1)).toEqual(route[1]!.end);
  });
});

describe('flow replay phases and journeys', () => {
  it('works out the Scrum phase before and during the history', () => {
    const timeline = buildTimeline(
      [
        act('ceremony.started', { ceremony: 'kickoff' }),
        act('project.kickoff_completed'),
        act('sprint.started'),
        act('ceremony.started', { ceremony: 'sprint_review' }),
        act('sprint.completed'),
      ].reverse(),
    );
    const phases = snapshots(timeline, [], kindOfColumn, { kickoffDone: true, sprintActive: false }).map(snapshotPhase);
    expect(phases).toEqual(['kickoff', 'kickoff', 'sprint_planning', 'sprint', 'sprint_review', 'sprint_planning']);
    // A history that starts mid-sprint.
    const mid = buildTimeline([act('sprint.completed')]);
    expect(snapshots(mid, [], kindOfColumn, { kickoffDone: true, sprintActive: false }).map(snapshotPhase)).toEqual(['sprint', 'sprint_planning']);
  });

  it('lists an item\'s journey with the time spent in each stage', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
    const timeline = [
      act('task.created', { taskId: 'a', toKind: 'backlog', createdAt: at(0) }),
      act('task.moved', { taskId: 'b', fromKind: 'todo', toKind: 'in_progress', createdAt: at(5) }),
      act('task.moved', { taskId: 'a', fromKind: 'backlog', toKind: 'todo', createdAt: at(10) }),
      act('task.started', { taskId: 'a', createdAt: at(20) }), // not a stage change
      act('task.moved', { taskId: 'a', fromKind: 'todo', toKind: 'done', createdAt: at(40) }),
    ];
    const journey = journeyOf(timeline, 'a');
    expect(journey.map((j) => [j.stage, j.durationMs])).toEqual([
      ['backlog', 10_000],
      ['todo', 30_000],
      ['done', null],
    ]);
  });
});

describe('flow replay at scale and ordering', () => {
  it('keeps events of one transaction in the order they were recorded', () => {
    const at = '2026-01-01T00:00:00.000Z';
    // The API lists newest first: "started" was recorded after the move in the same millisecond.
    const newestFirst = [
      act('task.started', { taskId: 'a', createdAt: at, roleKey: 'senior_developer' }),
      act('task.moved', { taskId: 'a', fromKind: 'todo', toKind: 'in_progress', createdAt: at }),
    ];
    const timeline = buildTimeline(newestFirst);
    expect(timeline.map((a) => a.action)).toEqual(['task.moved', 'task.started']);
    const snaps = snapshots(timeline, [task('a', 'in_progress')], kindOfColumn);
    expect(snaps[2]!.agents.get('Claude Code')!.stage).toBe('in_progress');
  });

  it('jumps to any moment of a long history from checkpoints', () => {
    const items = Array.from({ length: 40 }, (_, i) => task(`t${i}`, 'done'));
    const history: ActivityDTO[] = [];
    for (const t of items) {
      history.push(act('task.created', { taskId: t.id, toKind: 'backlog' }));
      history.push(act('task.moved', { taskId: t.id, fromKind: 'backlog', toKind: 'todo' }));
      history.push(act('task.moved', { taskId: t.id, fromKind: 'todo', toKind: 'done' }));
    }
    const timeline = buildTimeline([...history].reverse());
    expect(timeline).toHaveLength(120);
    const replay = createReplay(timeline, items, kindOfColumn);
    const full = snapshots(timeline, items, kindOfColumn);
    for (const i of [0, 1, 49, 50, 51, 99, 100, 119, 120]) expect(Object.fromEntries(stageCounts(replay.at(i))), `at ${i}`).toEqual(Object.fromEntries(stageCounts(full[i]!)));
    expect(Object.fromEntries(stageCounts(replay.at(120)))).toEqual({ done: 40 });
    expect(replay.at(999).stageOf.size).toBe(40); // clamped to the end
    // Snapshots handed out are copies: changing one never changes the replay.
    replay.at(60).stageOf.clear();
    expect(replay.at(60).stageOf.size).toBeGreaterThan(0);
  });
});
