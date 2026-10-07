// Rebuilds the flow at any point of the recorded history. The activity log stores every move
// with its from/to stages, so the state before the first event is found by undoing the moves
// from today's board, and any later moment by replaying them forward.
import { FLOW_ACTIONS, type ActivityDTO, type Ceremony, type ColumnKind, type TaskDTO } from '@loop/shared';
import { isCeremony, type StageId } from './model';

const FLOW = new Set<string>(FLOW_ACTIONS);

export interface AgentTrace {
  name: string;
  stage: StageId;
  roleKey: string | null;
  taskKey: string | null;
  at: string;
}

export interface FlowSnapshot {
  /** Stage of every work item that existed at that moment. */
  stageOf: Map<string, ColumnKind>;
  /** Last known position of each agent (by name). */
  agents: Map<string, AgentTrace>;
  /** Ceremony being run, if one had started and not finished yet. */
  ceremony: Ceremony | null;
  kickoffDone: boolean;
  sprintActive: boolean;
}

/** Today's project state, used to work out how things stood before the history starts. */
export interface FlowNow {
  kickoffDone: boolean;
  sprintActive: boolean;
}

/** Flow events, oldest first (the API returns newest first). */
export function buildTimeline(activities: ActivityDTO[]): ActivityDTO[] {
  return activities
    .filter((a) => FLOW.has(a.action))
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Work items as they were just before the first event of the timeline. */
export function initialSnapshot(
  timeline: ActivityDTO[],
  tasks: TaskDTO[],
  columnKindOf: (columnId: string) => ColumnKind | undefined,
  now: FlowNow = { kickoffDone: true, sprintActive: false },
): FlowSnapshot {
  const stageOf = new Map<string, ColumnKind>();
  for (const t of tasks) {
    if (t.type === 'epic') continue;
    const kind = columnKindOf(t.columnId);
    if (kind) stageOf.set(t.id, kind);
  }
  for (let i = timeline.length - 1; i >= 0; i--) {
    const a = timeline[i]!;
    if (!a.taskId || !stageOf.has(a.taskId)) continue;
    if (a.action === 'task.created') stageOf.delete(a.taskId);
    else if ((a.action === 'task.moved' || a.action === 'task.escalated') && a.fromKind) stageOf.set(a.taskId, a.fromKind);
  }
  // The first sprint event tells whether a sprint was running when the history starts.
  const firstSprint = timeline.find((a) => a.action === 'sprint.started' || a.action === 'sprint.completed');
  return {
    stageOf,
    agents: new Map(),
    ceremony: null,
    kickoffDone: now.kickoffDone && !timeline.some((a) => a.action === 'project.kickoff_completed'),
    sprintActive: firstSprint ? firstSprint.action === 'sprint.completed' : now.sprintActive,
  };
}

function cloneSnapshot(s: FlowSnapshot): FlowSnapshot {
  return { ...s, stageOf: new Map(s.stageOf), agents: new Map(s.agents) };
}

/** Apply one event (mutates the snapshot). `isWorkItem` filters out epics and deleted items. */
export function applyEvent(snapshot: FlowSnapshot, a: ActivityDTO, isWorkItem: (taskId: string) => boolean): void {
  const item = a.taskId && isWorkItem(a.taskId) ? a.taskId : null;
  if (item && a.toKind && (a.action === 'task.created' || a.action === 'task.moved' || a.action === 'task.escalated')) {
    snapshot.stageOf.set(item, a.toKind);
  }

  let stage: StageId | undefined;
  switch (a.action) {
    case 'ceremony.started':
      if (a.ceremony) {
        snapshot.ceremony = a.ceremony;
        stage = a.ceremony;
      }
      break;
    case 'project.kickoff_completed':
      snapshot.ceremony = null;
      snapshot.kickoffDone = true;
      stage = 'backlog';
      break;
    case 'sprint.completed':
      snapshot.ceremony = null;
      snapshot.sprintActive = false;
      stage = 'backlog';
      break;
    case 'sprint.started':
      snapshot.ceremony = null;
      snapshot.sprintActive = true;
      stage = 'todo';
      break;
    case 'task.started':
      stage = (item && snapshot.stageOf.get(item)) || undefined;
      break;
    case 'task.moved':
    case 'task.escalated':
      stage = a.toKind ?? undefined;
      break;
    case 'task.refined':
      stage = 'backlog';
      break;
    case 'task.created': {
      // Items created during a ceremony (e.g. the kickoff) do not pull the agent out of it.
      const current = a.actorName ? snapshot.agents.get(a.actorName)?.stage : undefined;
      stage = current && isCeremony(current) ? current : (a.toKind ?? 'backlog');
      break;
    }
  }
  if (a.actorType === 'agent' && a.actorName && stage) {
    snapshot.agents.set(a.actorName, { name: a.actorName, stage, roleKey: a.roleKey, taskKey: a.taskKey, at: a.createdAt });
  }
}

/**
 * Snapshots before each event: `result[i]` is the state just before `timeline[i]`, and the last
 * entry is the state after every event. Computed once so scrubbing is instant.
 */
export function snapshots(
  timeline: ActivityDTO[],
  tasks: TaskDTO[],
  columnKindOf: (columnId: string) => ColumnKind | undefined,
  now?: FlowNow,
): FlowSnapshot[] {
  const workItems = new Set(tasks.filter((t) => t.type !== 'epic').map((t) => t.id));
  const isWorkItem = (id: string) => workItems.has(id);
  let current = initialSnapshot(timeline, tasks, columnKindOf, now);
  const result: FlowSnapshot[] = [current];
  for (const a of timeline) {
    current = cloneSnapshot(current);
    applyEvent(current, a, isWorkItem);
    result.push(current);
  }
  return result;
}

/** Number of items in each stage of a snapshot. */
export function stageCounts(snapshot: FlowSnapshot): Map<ColumnKind, number> {
  const counts = new Map<ColumnKind, number>();
  for (const kind of snapshot.stageOf.values()) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return counts;
}

/** Last stage of every agent according to the history (used to place agents between items). */
export function lastStages(timeline: ActivityDTO[]): Map<string, StageId> {
  const snapshot: FlowSnapshot = { stageOf: new Map(), agents: new Map(), ceremony: null, kickoffDone: true, sprintActive: false };
  for (const a of timeline) applyEvent(snapshot, a, () => true);
  return new Map([...snapshot.agents.values()].map((t) => [t.name, t.stage]));
}

/** The Scrum phase at a moment of the replay. */
export function snapshotPhase(s: FlowSnapshot): 'kickoff' | 'sprint_planning' | 'sprint' | 'sprint_review' {
  if (s.ceremony) return s.ceremony;
  if (!s.kickoffDone) return 'kickoff';
  return s.sprintActive ? 'sprint' : 'sprint_planning';
}

export interface JourneyStep {
  activity: ActivityDTO;
  stage: ColumnKind | null;
  /** Time spent in this stage until the next step (ms), or null for the current stage. */
  durationMs: number | null;
}

/** Events that put a work item into a stage (it was created there or moved there). */
export const isStageChange = (a: ActivityDTO, taskId: string): boolean => a.taskId === taskId && a.toKind !== null;

/** One work item's path through the flow, oldest first, with the time it spent in each stage. */
export function journeyOf(timeline: ActivityDTO[], taskId: string): JourneyStep[] {
  const events = timeline.filter((a) => isStageChange(a, taskId));
  return events.map((a, i) => {
    const next = events[i + 1];
    return {
      activity: a,
      stage: a.toKind,
      durationMs: next ? Date.parse(next.createdAt) - Date.parse(a.createdAt) : null,
    };
  });
}
