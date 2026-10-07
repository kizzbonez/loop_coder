import { useEffect, useMemo, useState } from 'react';
import type { ActivityDTO, AgentRoleDTO, ColumnKind, ProjectDetailDTO, TaskDTO } from '@loop/shared';
import { buildStages, currentPhase, placeAgents, transitionCounts, type FlowAgent, type FlowPhase, type FlowStage, type StageId } from '../lib/flow/model';
import { buildTimeline, createReplay, isStageChange, journeyOf, lastStages, snapshotPhase, stageCounts, type FlowNow, type JourneyStep } from '../lib/flow/replay';
import { useFlowActivity } from '../lib/queries';
import { useReplay, type ReplayControls } from './useReplay';

const FEED_SIZE = 40;
/** Live events to animate at once (e.g. after a reconnect or a sprint start). */
const MAX_LIVE_BURST = 8;

/** What the flow is built from: the project, its work items and the agent roles. */
export interface FlowSource {
  project: ProjectDetailDTO;
  tasks: TaskDTO[];
  roles: AgentRoleDTO[];
}

export interface FlowState {
  loading: boolean;
  replaying: boolean;
  stages: Map<StageId, FlowStage>;
  counts: Map<StageId, number>;
  agents: FlowAgent[];
  phase: FlowPhase;
  /** Flow events up to now (or up to the replay cursor), newest first. */
  feed: ActivityDTO[];
  /** Events to animate right now; views skip keys they already animated (see `animationKey`). */
  animate: ActivityDTO[];
  /** Makes each animation unique: a replayed step animates again after rewinding. */
  animationKey: (a: ActivityDTO) => string;
  /** How often work took each path (edge id → count). */
  edgeCounts: Map<string, number>;
  replay: ReplayControls & {
    /** Time of the moment shown, or null at the very start. */
    at: string | null;
    /** The work item being followed, if this is a journey replay. */
    focusTaskId: string | null;
    journey: JourneyStep[];
    /** Edges the followed item travelled. */
    journeyEdges: Set<string>;
  };
}

/** The history as it stood when a replay started; live changes do not shift the replay. */
interface ReplayTape {
  timeline: ActivityDTO[];
  tasks: TaskDTO[];
  now: FlowNow;
}

/**
 * Everything the Flow graph and the pixel office show, live or replayed. Live: stage counts from
 * the board, agents from presence, animations for events that arrive while watching. Replay:
 * the same, rebuilt from the recorded history at the replay cursor; a journey replay follows a
 * single work item.
 */
export function useFlowState({ project, tasks, roles }: FlowSource, options: { replay: boolean; focusTaskId?: string | null }): FlowState {
  const focusTaskId = options.replay ? (options.focusTaskId ?? null) : null;
  const history = useFlowActivity(project.id);
  const timeline = useMemo(() => buildTimeline(history.data ?? []), [history.data]);
  const columnsById = useMemo(() => new Map(project.columns.map((c) => [c.id, c])), [project.columns]);
  const stages = useMemo(() => buildStages(project.columns, tasks, roles), [project.columns, tasks, roles]);

  // --- Replay ------------------------------------------------------------------
  const kickoffDone = Boolean(project.kickoffCompletedAt);
  const sprintActive = Boolean(project.activeSprint);
  const liveTape = useMemo<ReplayTape>(() => ({ timeline, tasks, now: { kickoffDone, sprintActive } }), [timeline, tasks, kickoffDone, sprintActive]);
  const [frozen, setFrozen] = useState<ReplayTape | null>(null);
  const loaded = Boolean(history.data);
  useEffect(() => {
    if (!options.replay) setFrozen(null);
    else if (loaded) setFrozen((t) => t ?? liveTape);
  }, [options.replay, loaded, liveTape]);
  const tape = frozen ?? liveTape;
  const replayTimeline = tape.timeline;

  const steps = useMemo(
    () => (focusTaskId ? replayTimeline.flatMap((a, i) => (isStageChange(a, focusTaskId) ? [i] : [])) : replayTimeline.map((_, i) => i)),
    [replayTimeline, focusTaskId],
  );
  const player = useReplay(steps.length, undefined, options.replay ? (focusTaskId ?? 'all') : 'live');
  const replay = useMemo(
    () => (options.replay ? createReplay(tape.timeline, tape.tasks, (id) => columnsById.get(id)?.kind, tape.now) : null),
    [options.replay, tape, columnsById],
  );
  const journey = useMemo(() => (focusTaskId ? journeyOf(replayTimeline, focusTaskId) : []), [replayTimeline, focusTaskId]);
  const journeyEdges = useMemo(() => new Set(transitionCounts(journey.map((j) => j.activity)).keys()), [journey]);

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
    // Index into the timeline: everything before it has happened.
    const upTo = player.cursor === 0 ? (focusTaskId ? (steps[0] ?? 0) : 0) : steps[player.cursor - 1]! + 1;
    const snapshot = replay?.at(upTo);
    const shown = replayTimeline.slice(0, upTo);
    const current = player.cursor > 0 ? replayTimeline[steps[player.cursor - 1]!] : undefined;
    const agents: FlowAgent[] = [...(snapshot?.agents.values() ?? [])]
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
    return {
      loading: history.isPending,
      replaying: true,
      stages,
      counts: new Map<StageId, number>(snapshot ? stageCounts(snapshot) : []),
      agents,
      phase: snapshot ? snapshotPhase(snapshot) : 'sprint',
      feed: shown.slice(-FEED_SIZE).reverse(),
      animate: player.advanced && current ? [current] : [],
      animationKey: (a) => `${a.id}#${player.serial}`,
      edgeCounts: transitionCounts(shown),
      replay: { ...player, at: current?.createdAt ?? null, focusTaskId, journey, journeyEdges },
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
    animate: knownIds ? timeline.filter((a) => !knownIds.has(a.id)).slice(-MAX_LIVE_BURST) : [],
    animationKey: (a) => a.id,
    edgeCounts: transitionCounts(history.data ?? []),
    replay: { ...player, at: null, focusTaskId: null, journey: [], journeyEdges: new Set() },
  };
}
