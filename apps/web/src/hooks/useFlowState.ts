import { useEffect, useMemo, useState } from 'react';
import type { ActivityDTO, AgentRoleDTO, ColumnKind, ProjectDetailDTO, RemarkDTO, ReplayDTO, ReplaySegmentDTO, TaskDTO } from '@loop/shared';
import { buildStages, currentPhase, placeAgents, transitionCounts, type FlowAgent, type FlowPhase, type FlowStage, type StageId } from '../lib/flow/model';
import { buildTimeline, isStageChange, journeyOf, lastStages, stageCounts, type FlowNow, type JourneyStep } from '../lib/flow/replay';
import { buildReplayModel, countUpTo } from '../lib/flow/timeline';
import { useFlowActivity, useReplayData } from '../lib/queries';
import { useTimeReplay, type TimeReplay } from './useTimeReplay';

const FEED_SIZE = 40;
/** Events to animate at once (e.g. after a reconnect, a sprint start or a fast replay). */
const MAX_BURST = 8;

/** What the flow is built from: the project, its work items and the agent roles. */
export interface FlowSource {
  project: ProjectDetailDTO;
  tasks: TaskDTO[];
  roles: AgentRoleDTO[];
}

export interface ReplayInfo extends TimeReplay {
  /** The moment shown, or null when nothing is loaded. */
  at: string | null;
  /** Parts of the history that can be replayed (whole project, kickoff, each sprint). */
  segments: ReplaySegmentDTO[];
  segment: ReplaySegmentDTO | null;
  /** The work item being followed, if this is a journey replay. */
  focusTaskId: string | null;
  journey: JourneyStep[];
  /** Edges the followed item travelled. */
  journeyEdges: Set<string>;
  /** Journey steps reached at this moment. */
  reached: number;
  /** True when agents come from the recorded presence log, false when inferred from their actions. */
  exact: boolean;
  /** When the presence log starts for this project (earlier moments are inferred). */
  presenceSince: string | null;
  /** A size limit cut the history, so the replay may be approximate. */
  truncated: boolean;
  /** What happened inside the segment, oldest first: the office speaks these. */
  events: ActivityDTO[];
  remarks: RemarkDTO[];
}

export interface FlowState {
  loading: boolean;
  replaying: boolean;
  stages: Map<StageId, FlowStage>;
  counts: Map<StageId, number>;
  agents: FlowAgent[];
  phase: FlowPhase;
  /** Flow events up to now (or up to the replayed moment), newest first. */
  feed: ActivityDTO[];
  /** Events to animate right now; views skip keys they already animated (see `animationKey`). */
  animate: ActivityDTO[];
  /** Makes each animation unique: a replayed event animates again after rewinding. */
  animationKey: (a: ActivityDTO) => string;
  /** How often work took each path (edge id → count). */
  edgeCounts: Map<string, number>;
  replay: ReplayInfo;
}

/** The board as it was when a replay was loaded; later live changes do not shift the replay. */
interface Frozen {
  data: ReplayDTO;
  tasks: TaskDTO[];
  now: FlowNow;
  loadedAt: number;
}

/**
 * Everything the Flow graph and the pixel office show, live or replayed. Live: stage counts from
 * the board, agents from presence, animations for events that arrive while watching. Replay: one
 * segment of the history (the whole project, the kickoff or a sprint) on a real clock, rebuilt
 * from what was recorded at each moment; a journey replay follows a single work item.
 */
export function useFlowState({ project, tasks, roles }: FlowSource, options: { replay: boolean; segment?: string; focusTaskId?: string | null }): FlowState {
  const focusTaskId = options.replay ? (options.focusTaskId ?? null) : null;
  const segmentId = focusTaskId ? 'all' : (options.segment ?? 'all');
  const history = useFlowActivity(project.id);
  const timeline = useMemo(() => buildTimeline(history.data ?? []), [history.data]);
  const columnsById = useMemo(() => new Map(project.columns.map((c) => [c.id, c])), [project.columns]);
  const stages = useMemo(() => buildStages(project.columns, tasks, roles), [project.columns, tasks, roles]);

  // --- Replay ------------------------------------------------------------------
  const replayData = useReplayData(project.id, segmentId, options.replay);
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const kickoffDone = Boolean(project.kickoffCompletedAt);
  const sprintActive = Boolean(project.activeSprint);
  useEffect(() => {
    if (!options.replay) setFrozen(null);
    else if (replayData.data && frozen?.data !== replayData.data) {
      setFrozen({ data: replayData.data, tasks, now: { kickoffDone, sprintActive }, loadedAt: Date.now() });
    }
  }, [options.replay, replayData.data, frozen, tasks, kickoffDone, sprintActive]);

  const model = useMemo(
    () => (options.replay && frozen ? buildReplayModel(frozen.data, frozen.tasks, (id) => columnsById.get(id)?.kind, frozen.now, frozen.loadedAt) : null),
    [options.replay, frozen, columnsById],
  );
  const journey = useMemo(() => (model && focusTaskId ? journeyOf(model.timeline, focusTaskId) : []), [model, focusTaskId]);
  const journeyTimes = useMemo(() => journey.map((s) => Date.parse(s.activity.createdAt)), [journey]);
  const journeyEdges = useMemo(() => new Set(transitionCounts(journey.map((j) => j.activity)).keys()), [journey]);

  // A journey plays from just before the item appeared to its last move; a segment from its start to its end.
  const span = !model
    ? { start: 0, end: 0, marks: [] as number[] }
    : focusTaskId
      ? journeyTimes.length
        ? { start: journeyTimes[0]! - 1000, end: journeyTimes.at(-1)!, marks: journeyTimes }
        : { start: model.start, end: model.start, marks: [] }
      : { start: model.start, end: model.end, marks: model.marks };
  const tape = options.replay ? `${segmentId}:${focusTaskId ?? ''}:${model ? frozen?.loadedAt : 'loading'}` : 'live';
  const player = useTimeReplay(span.start, span.end, span.marks, tape);

  // --- Live animations -----------------------------------------------------------
  // Events already in the first load are history; only later arrivals animate.
  const [knownIds, setKnownIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (history.data) setKnownIds((known) => known ?? new Set(history.data.map((a) => a.id)));
  }, [history.data]);
  const lastByName = useMemo(() => lastStages(timeline), [timeline]);
  // Presence lists the most recently active agent first; a stable order keeps agents from
  // swapping places every time one of them calls the server.
  const online = useMemo(() => [...(project.agents ?? [])].sort((a, b) => a.id.localeCompare(b.id)), [project.agents]);

  if (options.replay) {
    const t = player.t;
    const frame = model?.frame(t);
    const segmentStart = focusTaskId ? -Infinity : (model?.start ?? 0);
    const upTo = model ? countUpTo(model.times, t) : 0;
    const shown = model ? model.timeline.slice(0, upTo).filter((_, i) => model.times[i]! >= segmentStart) : [];
    const shownForItem = focusTaskId ? shown.filter((a) => isStageChange(a, focusTaskId)) : shown;
    const passed = model && player.advanced ? model.timeline.slice(countUpTo(model.times, player.prev), upTo).slice(-MAX_BURST) : [];
    return {
      loading: replayData.isPending || !model,
      replaying: true,
      stages,
      counts: new Map<StageId, number>(frame ? stageCounts(frame.snapshot) : []),
      agents: frame?.agents ?? [],
      phase: frame?.phase ?? 'sprint',
      feed: (focusTaskId ? shownForItem : shown).slice(-FEED_SIZE).reverse(),
      animate: focusTaskId ? passed.filter((a) => isStageChange(a, focusTaskId)) : passed,
      animationKey: (a) => `${a.id}#${player.serial}`,
      edgeCounts: transitionCounts(shown),
      replay: {
        ...player,
        at: model ? new Date(t).toISOString() : null,
        segments: frozen?.data.segments ?? [],
        segment: model?.segment ?? null,
        focusTaskId,
        journey,
        journeyEdges,
        reached: countUpTo(journeyTimes, t),
        exact: frame?.exact ?? false,
        presenceSince: frozen?.data.presenceSince ?? null,
        truncated: frozen?.data.truncated ?? false,
        events: model?.events ?? [],
        remarks: model?.remarks ?? [],
      },
    };
  }

  const stageOfTask = (taskId: string): ColumnKind | undefined => {
    const task = tasks.find((t) => t.id === taskId);
    return task ? columnsById.get(task.columnId)?.kind : undefined;
  };
  const counts = new Map<StageId, number>([...stages.values()].map((s) => [s.id, s.tasks.length]));
  const agents = placeAgents(online, stageOfTask, lastByName);
  return {
    loading: history.isPending,
    replaying: false,
    stages,
    counts,
    agents,
    phase: currentPhase(project, agents),
    feed: (history.data ?? []).slice(0, FEED_SIZE),
    animate: knownIds ? timeline.filter((a) => !knownIds.has(a.id)).slice(-MAX_BURST) : [],
    animationKey: (a) => a.id,
    edgeCounts: transitionCounts(history.data ?? []),
    replay: {
      ...player,
      at: null,
      segments: [],
      segment: null,
      focusTaskId: null,
      journey: [],
      journeyEdges: new Set(),
      reached: 0,
      exact: true,
      presenceSince: null,
      truncated: false,
      events: [],
      remarks: [],
    },
  };
}
