import { useEffect, useMemo, useRef } from 'react';
import type { ActivityDTO, ColumnKind } from '@loop/shared';
import { buildStages, currentPhase, placeAgents, transitionCounts, type FlowAgent, type FlowPhase, type FlowStage, type StageId } from '../lib/flow/model';
import { buildTimeline, isStageChange, journeyOf, lastStages, snapshotPhase, snapshots, stageCounts, type JourneyStep } from '../lib/flow/replay';
import { useFlowActivity } from '../lib/queries';
import type { ProjectContext } from '../pages/project/context';
import { useReplay, type ReplayControls } from './useReplay';

const FEED_SIZE = 40;
/** Live events to animate at once (e.g. after a reconnect or a sprint start). */
const MAX_LIVE_BURST = 8;

export interface FlowState {
  loading: boolean;
  replaying: boolean;
  stages: Map<StageId, FlowStage>;
  counts: Map<StageId, number>;
  agents: FlowAgent[];
  phase: FlowPhase;
  /** Flow events up to now (or up to the replay cursor), newest first. */
  feed: ActivityDTO[];
  /** Events to animate right now; views skip ids they already animated. */
  animate: ActivityDTO[];
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

/**
 * Everything the Flow graph and the pixel office show, live or replayed. Live: stage counts from
 * the board, agents from presence, animations for events that arrive while watching. Replay:
 * the same, rebuilt from the recorded history at the replay cursor; a journey replay follows a
 * single work item.
 */
export function useFlowState(ctx: ProjectContext, options: { replay: boolean; focusTaskId?: string | null }): FlowState {
  const { project, tasks, roles } = ctx;
  const focusTaskId = options.replay ? (options.focusTaskId ?? null) : null;
  const history = useFlowActivity(project.id);
  const timeline = useMemo(() => buildTimeline(history.data ?? []), [history.data]);

  const columnsById = useMemo(() => new Map(project.columns.map((c) => [c.id, c])), [project.columns]);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const stageOfTask = (taskId: string): ColumnKind | undefined => {
    const task = tasksById.get(taskId);
    return task ? columnsById.get(task.columnId)?.kind : undefined;
  };
  const stages = useMemo(() => buildStages(project.columns, tasks, roles), [project.columns, tasks, roles]);

  // --- Replay ------------------------------------------------------------------
  const steps = useMemo(
    () => (focusTaskId ? timeline.flatMap((a, i) => (isStageChange(a, focusTaskId) ? [i] : [])) : timeline.map((_, i) => i)),
    [timeline, focusTaskId],
  );
  const player = useReplay(steps.length, undefined, options.replay ? (focusTaskId ?? 'all') : 'live');
  const snaps = useMemo(
    () =>
      options.replay
        ? snapshots(timeline, tasks, (id) => columnsById.get(id)?.kind, {
            kickoffDone: Boolean(project.kickoffCompletedAt),
            sprintActive: Boolean(project.activeSprint),
          })
        : null,
    [options.replay, timeline, tasks, columnsById, project.kickoffCompletedAt, project.activeSprint],
  );
  // Index into the timeline: everything before it has happened.
  const upTo = player.cursor === 0 ? (focusTaskId ? (steps[0] ?? 0) : 0) : steps[player.cursor - 1]! + 1;
  const journey = useMemo(() => (focusTaskId ? journeyOf(timeline, focusTaskId) : []), [timeline, focusTaskId]);
  const journeyEdges = useMemo(() => {
    const ids = new Set<string>();
    for (const [edgeIdValue] of transitionCounts(journey.map((j) => j.activity))) ids.add(edgeIdValue);
    return ids;
  }, [journey]);

  // --- Live animations -----------------------------------------------------------
  // Events already in the first load are history; only later arrivals animate.
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (history.data && !knownIds.current) knownIds.current = new Set(history.data.map((a) => a.id));
  }, [history.data]);

  const lastByName = useMemo(() => lastStages(timeline), [timeline]);

  if (snaps) {
    const snapshot = snaps[Math.min(upTo, snaps.length - 1)]!;
    const counts = new Map<StageId, number>(stageCounts(snapshot));
    const agents: FlowAgent[] = [...snapshot.agents.values()].map((a) => ({
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
    const shown = timeline.slice(0, upTo);
    const current = player.cursor > 0 ? timeline[steps[player.cursor - 1]!] : undefined;
    return {
      loading: history.isPending,
      replaying: true,
      stages,
      counts,
      agents,
      phase: snapshotPhase(snapshot),
      feed: shown.slice(-FEED_SIZE).reverse(),
      animate: player.advanced && current ? [current] : [],
      edgeCounts: transitionCounts(shown),
      replay: { ...player, at: current?.createdAt ?? null, focusTaskId, journey, journeyEdges },
    };
  }

  const counts = new Map<StageId, number>([...stages.values()].map((s) => [s.id, s.tasks.length]));
  const agents = placeAgents(project.agents ?? [], stageOfTask, lastByName);
  const known = knownIds.current;
  const animate = known ? timeline.filter((a) => !known.has(a.id)).slice(-MAX_LIVE_BURST) : [];
  return {
    loading: history.isPending,
    replaying: false,
    stages,
    counts,
    agents,
    phase: currentPhase(project, agents),
    feed: (history.data ?? []).slice(0, FEED_SIZE),
    animate,
    edgeCounts: transitionCounts(history.data ?? []),
    replay: { ...player, at: null, focusTaskId: null, journey: [], journeyEdges: new Set() },
  };
}
