// The SDLC flow of a project as data: stages, the paths work takes between them, and where each
// agent is. Shared by the Flow graph and the pixel office; rendering lives in the views.
import { CEREMONY_LABELS, type ActivityDTO, type AgentRoleDTO, type Ceremony, type ColumnDTO, type ColumnKind, type OnlineAgentDTO, type ProjectDetailDTO, type TaskDTO } from '@loop/shared';

/** Board stages in the order work flows through them. */
export const PIPELINE: readonly ColumnKind[] = ['backlog', 'todo', 'in_progress', 'review', 'testing', 'done'];

/** A place on the flow: a board column, a Scrum ceremony, or the lounge for idle agents. */
export type StageId = ColumnKind | Ceremony | 'lounge';

export const isCeremony = (id: StageId): id is Ceremony => id === 'kickoff' || id === 'sprint_planning' || id === 'sprint_review';

export interface FlowStage {
  id: StageId;
  type: 'column' | 'ceremony' | 'lounge';
  label: string;
  /** Role working this stage; undefined when each item brings its own role. */
  role?: AgentRoleDTO;
  roleFromItems: boolean;
  wipLimit: number | null;
  /** Work items (not epics) currently in this stage, in board order. */
  tasks: TaskDTO[];
  points: number;
}

export type EdgeKind = 'forward' | 'rework' | 'escalate' | 'resolve' | 'ceremony' | 'loop' | 'reopen' | 'other';

export interface FlowEdge {
  id: string;
  from: StageId;
  to: StageId;
  kind: EdgeKind;
  label?: string;
}

export const edgeId = (from: StageId, to: StageId): string => `${from}->${to}`;

const edge = (from: StageId, to: StageId, kind: EdgeKind, label?: string): FlowEdge => ({ id: edgeId(from, to), from, to, kind, label });

/** The paths drawn permanently: the Scrum loop, the delivery pipeline, rework and human help. */
export const STATIC_EDGES: readonly FlowEdge[] = [
  edge('kickoff', 'backlog', 'ceremony', 'creates the backlog'),
  edge('backlog', 'sprint_planning', 'ceremony', 'refined items'),
  edge('sprint_planning', 'todo', 'ceremony', 'commits'),
  edge('todo', 'in_progress', 'forward'),
  edge('in_progress', 'review', 'forward'),
  edge('review', 'testing', 'forward'),
  edge('testing', 'done', 'forward'),
  edge('review', 'in_progress', 'rework', 'changes requested'),
  edge('testing', 'in_progress', 'rework', 'failed QA'),
  edge('in_progress', 'blocked', 'escalate', 'asks you'),
  edge('blocked', 'in_progress', 'resolve', 'your answer'),
  edge('done', 'sprint_review', 'ceremony'),
  edge('sprint_review', 'sprint_planning', 'loop', 'next sprint'),
];

const STATIC_BY_ID = new Map(STATIC_EDGES.map((e) => [e.id, e]));

export function classifyMove(from: ColumnKind | null, to: ColumnKind): EdgeKind {
  if (from === null) return 'other';
  if (to === 'blocked') return 'escalate';
  if (from === 'blocked') return 'resolve';
  if (from === 'done') return 'reopen';
  return PIPELINE.indexOf(to) > PIPELINE.indexOf(from) ? 'forward' : 'rework';
}

/**
 * The edges a work item travels along between two stages. Committing to a sprint passes through
 * sprint planning; transitions without a drawn path get a temporary direct edge.
 */
export function routeFor(from: StageId, to: StageId): FlowEdge[] {
  if (from === to) return [];
  if (from === 'backlog' && to === 'todo') return [STATIC_BY_ID.get('backlog->sprint_planning')!, STATIC_BY_ID.get('sprint_planning->todo')!];
  const known = STATIC_BY_ID.get(edgeId(from, to));
  if (known) return [known];
  const kind = isCeremony(from) || isCeremony(to) || from === 'lounge' || to === 'lounge' ? 'other' : classifyMove(from, to);
  return [edge(from, to, kind)];
}

export function buildStages(columns: ColumnDTO[], tasks: TaskDTO[], roles: AgentRoleDTO[]): Map<StageId, FlowStage> {
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const pm = roles.find((r) => r.key === 'project_manager');
  const stages = new Map<StageId, FlowStage>();
  for (const column of [...columns].sort((a, b) => a.position - b.position)) {
    const items = tasks.filter((t) => t.columnId === column.id && t.type !== 'epic').sort((a, b) => a.position - b.position);
    const roleFromItems = column.roleSource === 'task';
    stages.set(column.kind, {
      id: column.kind,
      type: 'column',
      label: column.name,
      role: column.agentRoleId ? rolesById.get(column.agentRoleId) : undefined,
      roleFromItems,
      wipLimit: column.wipLimit,
      tasks: items,
      points: items.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0),
    });
  }
  const backlogRole = stages.get('backlog')?.role ?? pm;
  for (const id of ['kickoff', 'sprint_planning', 'sprint_review'] as const) {
    stages.set(id, { id, type: 'ceremony', label: CEREMONY_LABELS[id], role: backlogRole, roleFromItems: false, wipLimit: null, tasks: [], points: 0 });
  }
  stages.set('lounge', { id: 'lounge', type: 'lounge', label: 'Lounge', roleFromItems: false, wipLimit: null, tasks: [], points: 0 });
  return stages;
}

export interface FlowAgent {
  id: string;
  name: string;
  userName: string | null;
  stage: StageId;
  roleKey: string | null;
  taskId: string | null;
  taskKey: string | null;
  activity: string | null;
  /** Holding a work item or running a ceremony right now. */
  working: boolean;
}

/**
 * Where each online agent is: at its ceremony, at the stage of the item it holds, or where its
 * last recorded action took it (`lastStageByName`, from the activity history), else the lounge.
 */
export function placeAgents(
  agents: OnlineAgentDTO[],
  stageOfTask: (taskId: string) => ColumnKind | undefined,
  lastStageByName: Map<string, StageId> = new Map(),
): FlowAgent[] {
  return agents.map((a) => {
    const taskStage = a.currentTaskId ? stageOfTask(a.currentTaskId) : undefined;
    const stage: StageId = a.currentCeremony ?? taskStage ?? lastStageByName.get(a.agentName) ?? 'lounge';
    return {
      id: a.id,
      name: a.agentName,
      userName: a.userName,
      stage,
      roleKey: a.currentRoleKey,
      taskId: a.currentTaskId,
      taskKey: a.currentTaskKey,
      activity: a.currentActivity,
      working: Boolean(a.currentCeremony || taskStage),
    };
  });
}

export type FlowPhase = 'kickoff' | 'sprint_planning' | 'sprint' | 'sprint_review';

/** The Scrum phase the project is in, for highlighting the loop. */
export function currentPhase(project: Pick<ProjectDetailDTO, 'kickoffCompletedAt' | 'activeSprint'>, agents: Array<{ stage: StageId; working: boolean }>): FlowPhase {
  const ceremony = agents.find((a) => a.working && isCeremony(a.stage))?.stage as Ceremony | undefined;
  if (ceremony) return ceremony;
  if (!project.kickoffCompletedAt) return 'kickoff';
  return project.activeSprint ? 'sprint' : 'sprint_planning';
}

/** How often work took each path, over the given history. */
export function transitionCounts(activities: ActivityDTO[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of activities) {
    if (!a.fromKind || !a.toKind || a.fromKind === a.toKind) continue;
    for (const e of routeFor(a.fromKind, a.toKind)) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  }
  return counts;
}
