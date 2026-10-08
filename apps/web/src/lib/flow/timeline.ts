// Replays on a real clock: the state of the flow and the office at any moment of a segment of the
// history. Agents come from the presence log (what the live views showed) when it covers the
// moment, and are inferred from their recorded actions before the log existed.
import type { ActivityDTO, ColumnKind, OnlineAgentDTO, PresenceEntryDTO, RemarkDTO, ReplayDTO, ReplaySegmentDTO, TaskDTO } from '@loop/shared';
import { isCeremony, placeAgents, type FlowAgent, type FlowPhase, type StageId } from './model';
import { buildTimeline, createReplay, snapshotPhase, type FlowNow, type FlowSnapshot, type Replay } from './replay';

/** A presence row is written by the same request as the action that caused it, a moment after it. */
export const SAME_REQUEST_MS = 2000;

/** Ids a replay segment can have in the URL (anything else is a work item to follow). */
export const SEGMENT_ID = /^(all|kickoff|latest|sprint-\d+)$/;

/** Number of sorted times that are ≤ t. */
export function countUpTo(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Agents online at `t` according to the presence log (oldest first): the latest row of each
 * session, if it is within the online window, just like the live view decides who is online.
 */
export function presenceAt(entries: PresenceEntryDTO[], times: number[], t: number, windowMs: number): OnlineAgentDTO[] {
  const latest = new Map<string, PresenceEntryDTO>();
  const upTo = countUpTo(times, t);
  for (let i = 0; i < upTo; i++) latest.set(entries[i]!.sessionId, entries[i]!);
  return [...latest.values()]
    .filter((p) => t - Date.parse(p.at) <= windowMs)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    .map((p) => ({
      id: p.sessionId,
      agentName: p.agentName,
      clientName: null,
      userName: p.userName,
      lastSeenAt: p.at,
      currentTaskId: p.taskId,
      currentTaskKey: p.taskKey,
      currentRoleKey: p.roleKey,
      currentCeremony: p.ceremony,
      currentActivity: p.activity,
    }));
}

/** A moment the agent was seen: any action or remark it recorded. */
export interface Sighting {
  at: number;
  name: string;
}

/**
 * Presence rows on the clock of the actions that caused them: a row written by the same request as
 * an action (same agent, at most SAME_REQUEST_MS after it) takes the action's time, so the agent
 * appears together with its action. Heartbeats and reads keep their own time. Sorted by that time.
 */
export function alignPresence(entries: PresenceEntryDTO[], actions: Sighting[]): { entries: PresenceEntryDTO[]; times: number[] } {
  const actionTimes = actions.map((a) => a.at);
  const aligned = entries.map((entry, order) => {
    const at = Date.parse(entry.at);
    for (let i = countUpTo(actionTimes, at) - 1; i >= 0 && actionTimes[i]! >= at - SAME_REQUEST_MS; i--) {
      if (actions[i]!.name === entry.agentName) return { entry, at: actionTimes[i]!, order };
    }
    return { entry, at, order };
  });
  aligned.sort((a, b) => a.at - b.at || a.order - b.order);
  return { entries: aligned.map((a) => a.entry), times: aligned.map((a) => a.at) };
}

/** Moments an agent's visible state changed or it went offline (no news for the online window). */
export function presenceChanges(entries: PresenceEntryDTO[], times: number[], windowMs: number): number[] {
  const marks: number[] = [];
  const last = new Map<string, { entry: PresenceEntryDTO; seen: number }>();
  entries.forEach((e, i) => {
    const before = last.get(e.sessionId);
    const seen = Date.parse(e.at);
    if (before && seen - before.seen > windowMs) marks.push(before.seen + windowMs);
    const changed = !before || seen - before.seen > windowMs || before.entry.taskId !== e.taskId || before.entry.roleKey !== e.roleKey || before.entry.ceremony !== e.ceremony || before.entry.activity !== e.activity;
    if (changed) marks.push(times[i]!);
    last.set(e.sessionId, { entry: e, seen });
  });
  for (const { seen } of last.values()) marks.push(seen + windowMs);
  return marks;
}

/**
 * Agents before the presence log existed: those who acted within the online window before `t`,
 * placed where their last recorded move took them.
 */
export function inferredAgents(snapshot: FlowSnapshot, sightings: Sighting[], sightingTimes: number[], t: number, windowMs: number): FlowAgent[] {
  const lastSeen = new Map<string, number>();
  const upTo = countUpTo(sightingTimes, t);
  for (let i = 0; i < upTo; i++) lastSeen.set(sightings[i]!.name, sightings[i]!.at);
  return [...snapshot.agents.values()]
    .filter((a) => {
      const seen = lastSeen.get(a.name) ?? Date.parse(a.at);
      return t - seen <= windowMs;
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({
      id: `replay:${a.name}`,
      name: a.name,
      userName: null,
      stage: a.stage,
      roleKey: a.roleKey,
      taskId: null,
      taskKey: a.taskKey,
      activity: null,
      working: a.stage !== 'lounge',
    }));
}

/** Everything shown at one moment of a replay. */
export interface ReplayFrame {
  /** Flow events applied so far. */
  index: number;
  snapshot: FlowSnapshot;
  agents: FlowAgent[];
  phase: FlowPhase;
  /** True when the agents come from the presence log, false when they are inferred. */
  exact: boolean;
}

export interface ReplayModel {
  segment: ReplaySegmentDTO;
  start: number;
  end: number;
  /** Flow events, oldest first (including those after the segment, used to rebuild its start). */
  timeline: ActivityDTO[];
  times: number[];
  /** Every moment something visible happened inside the segment, sorted: for stepping and skipping quiet times. */
  marks: number[];
  /** All activities and remarks inside the segment, oldest first (what the office says). */
  events: ActivityDTO[];
  remarks: RemarkDTO[];
  presenceSince: number | null;
  frame: (t: number) => ReplayFrame;
}

/**
 * Prepare one segment for replay. `tasks` and `now` are the board as it is today (frozen when the
 * replay was loaded): the state at the start of the segment is found by undoing later moves.
 */
export function buildReplayModel(
  data: ReplayDTO,
  tasks: TaskDTO[],
  columnKindOf: (columnId: string) => ColumnKind | undefined,
  now: FlowNow,
  loadedAt: number,
): ReplayModel {
  const { segment } = data;
  const start = Date.parse(segment.from);
  const end = Math.max(start, segment.to ? Date.parse(segment.to) : loadedAt);
  const inside = (at: string) => {
    const t = Date.parse(at);
    return t >= start && t <= end;
  };

  const timeline = buildTimeline(data.events);
  const times = timeline.map((a) => Date.parse(a.createdAt));
  const replay: Replay = createReplay(timeline, tasks, columnKindOf, now);

  const events = [...data.events].reverse().filter((a) => inside(a.createdAt));
  const remarks = data.remarks.filter((r) => inside(r.createdAt));
  const windowMs = data.onlineWindowMinutes * 60_000;

  // Every recorded action and remark of an agent: when it was seen.
  const agentActions = (list: ActivityDTO[]) => list.filter((a) => a.actorType === 'agent' && a.actorName).map((a) => ({ at: Date.parse(a.createdAt), name: a.actorName! }));
  const agentRemarks = (list: RemarkDTO[]) => list.filter((r) => r.authorType === 'agent' && r.authorName).map((r) => ({ at: Date.parse(r.createdAt), name: r.authorName! }));
  const sightings: Sighting[] = [...agentActions(events), ...agentRemarks(remarks)].sort((a, b) => a.at - b.at);
  const sightingTimes = sightings.map((s) => s.at);

  const { entries: presence, times: presenceTimes } = alignPresence(data.presence, [...agentActions([...data.events].reverse()), ...agentRemarks(data.remarks)].sort((a, b) => a.at - b.at));
  const presenceSince = data.presenceSince ? Math.min(Date.parse(data.presenceSince), presenceTimes[0] ?? Infinity) : null;

  const marks = [
    ...times,
    ...events.map((a) => Date.parse(a.createdAt)),
    ...remarks.map((r) => Date.parse(r.createdAt)),
    ...presenceChanges(presence, presenceTimes, windowMs),
  ]
    .filter((t) => t >= start && t <= end)
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t !== all[i - 1]);

  // Frames are asked for many times a second while playing: reuse the board while no event passes.
  let cached: { index: number; snapshot: FlowSnapshot } | null = null;
  const snapshotAt = (index: number) => {
    if (cached?.index !== index) cached = { index, snapshot: replay.at(index) };
    return cached.snapshot;
  };

  return {
    segment,
    start,
    end,
    timeline,
    times,
    marks,
    events,
    remarks,
    presenceSince,
    frame(t) {
      const index = countUpTo(times, t);
      const snapshot = snapshotAt(index);
      const exact = presenceSince !== null && t >= presenceSince;
      let agents: FlowAgent[];
      if (exact) {
        const lastStage = new Map<string, StageId>([...snapshot.agents.values()].map((a) => [a.name, a.stage]));
        agents = placeAgents(presenceAt(presence, presenceTimes, t, windowMs), (id) => snapshot.stageOf.get(id), lastStage);
      } else {
        agents = inferredAgents(snapshot, sightings, sightingTimes, t, windowMs);
      }
      const ceremony = agents.find((a) => a.working && isCeremony(a.stage))?.stage as FlowPhase | undefined;
      return { index, snapshot, agents, phase: ceremony ?? snapshotPhase(snapshot), exact };
    },
  };
}
