import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  formatTaskKey,
  PRIORITY_RANK,
  SPRINT_WORK_KINDS,
  type Ceremony,
  type RemarkKind,
  type TaskDetailDTO,
} from '@loop/shared';
import { db, type Tx } from '../../db/client';
import { boardColumns, projects, sprints, tasks, workspaces, type AgentRoleRow, type ColumnRow, type ProjectRow, type TaskRow } from '../../db/schema';
import { claimantOf, type Actor } from '../../lib/actor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { addMinutes, now } from '../../lib/time';
import { EventBatch } from '../../realtime/bus';
import { actorLabel, agentNameOf, recordActivity } from '../activity/activity.service';
import { requireProjectAccess } from '../projects/access';
import { columnByKind, getColumns, getProjectRow } from '../projects/projects.query';
import { listRoles } from '../roles/roles.service';
import { getSettings } from '../settings/settings.service';
import { completeSprintTx, insertSprint, startSprintTx } from '../sprints/sprints.service';
import { getActiveSprintRow } from '../sprints/sprints.query';
import { getTaskDTO, listRemarks, resolveTaskRef } from '../tasks/tasks.query';
import { CLEAR_CLAIM, insertRemark, moveTaskTx } from '../tasks/tasks.service';
import {
  kickoffInstructions,
  planningInstructions,
  reviewInstructions,
  taskInstructions,
} from './instructions';

export type NoWorkStatus = 'paused' | 'disabled' | 'complete' | 'waiting';

export type WorkPackage =
  | {
      kind: 'task';
      task: TaskDetailDTO;
      role: AgentRoleRow;
      column: ColumnRow;
      instructions: string;
    }
  | { kind: 'ceremony'; ceremony: Ceremony; role: AgentRoleRow; instructions: string }
  | { kind: 'none'; status: NoWorkStatus; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspacePath(tx: Tx, project: ProjectRow): string {
  const ws = tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();
  return `${ws?.slug ?? 'workspace'}/${project.key.toLowerCase()}`;
}

function rolesById(tx: Tx): Map<string, AgentRoleRow> {
  return new Map(listRoles(tx).map((r) => [r.id, r]));
}

/** The role that works on an item depends on its stage, and in some stages on the item's assigned role. */
export function effectiveRole(task: TaskRow, column: ColumnRow, roles: Map<string, AgentRoleRow>): AgentRoleRow | null {
  if (column.roleSource === 'task' && task.assignedRoleId) {
    const assigned = roles.get(task.assignedRoleId);
    if (assigned?.enabled) return assigned;
  }
  const role = column.agentRoleId ? roles.get(column.agentRoleId) : undefined;
  return role?.enabled ? role : null;
}

function projectManagerRole(columns: ColumnRow[], roles: Map<string, AgentRoleRow>): AgentRoleRow {
  const backlogRole = columnByKind(columns, 'backlog').agentRoleId;
  const role =
    (backlogRole && roles.get(backlogRole)) || [...roles.values()].find((r) => r.key === 'project_manager');
  if (!role) throw badRequest('No Project Manager role is configured for the backlog column');
  return role;
}

function claimFilter(claimant: string, t: Date) {
  return or(isNull(tasks.claimedBy), eq(tasks.claimedBy, claimant), lt(tasks.claimExpiresAt, t));
}

/** No unfinished dependency: every item this one depends on sits in the Done column. */
function dependenciesDone(doneColumnId: string) {
  return sql`not exists (select 1 from task_dependencies d join tasks dt on dt.id = d.depends_on_id where d.task_id = ${tasks.id} and dt.column_id <> ${doneColumnId})`;
}

function sortCandidates(rows: TaskRow[], columns: ColumnRow[], claimant: string): TaskRow[] {
  const pos = new Map(columns.map((c) => [c.id, c.position]));
  return [...rows].sort(
    (a, b) =>
      Number(b.claimedBy === claimant) - Number(a.claimedBy === claimant) || // resume own work first
      (pos.get(b.columnId) ?? 0) - (pos.get(a.columnId) ?? 0) || // pull system: finish work closest to Done
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.position - b.position,
  );
}

function bulletList(rows: Array<TaskRow & { key: string }>, columns?: ColumnRow[]): string {
  const names = new Map(columns?.map((c) => [c.id, c.name]));
  return rows
    .map(
      (t) =>
        `- **${t.key}** [${t.type}, ${t.priority}, ${t.storyPoints ?? '?'} pts${columns ? `, ${names.get(t.columnId)}` : ''}] ${t.title}`,
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

function claimTask(
  tx: Tx,
  batch: EventBatch,
  actor: Actor,
  project: ProjectRow,
  task: TaskRow,
  column: ColumnRow,
  role: AgentRoleRow,
  columns: ColumnRow[],
): WorkPackage {
  const claimant = claimantOf(actor);
  const t = now();
  let current = column;
  const alreadyMine = task.claimedBy === claimant && task.claimExpiresAt && task.claimExpiresAt > t;

  if (column.kind === 'todo') {
    current = columnByKind(columns, 'in_progress');
    moveTaskTx(tx, batch, actor, task, current.id, { roleKey: role.key });
  }
  tx.update(tasks)
    .set({
      claimedBy: claimant,
      claimAgentName: agentNameOf(actor),
      claimRoleKey: role.key,
      claimedAt: alreadyMine ? task.claimedAt : t,
      claimExpiresAt: addMinutes(t, getSettings().agent.claimTimeoutMinutes),
    })
    .where(eq(tasks.id, task.id))
    .run();

  const key = formatTaskKey(project.key, task.number);
  if (!alreadyMine) {
    recordActivity(tx, batch, {
      projectId: project.id,
      actor,
      action: 'task.started',
      taskId: task.id,
      taskKey: key,
      roleKey: role.key,
      message: `${actorLabel(actor, role.name)} started working on ${key}`,
    });
  }
  const dto = getTaskDTO(tx, task.id);
  batch.add(project.id, { type: 'task.upserted', task: dto });

  return {
    kind: 'task',
    task: { ...dto, remarks: listRemarks(task.id, tx) },
    role,
    column: current,
    instructions: taskInstructions({ project, column: current, role, taskKey: key, workspacePath: workspacePath(tx, project) }),
  };
}

function ceremonyAvailable(project: ProjectRow, claimant: string, t: Date): boolean {
  return (
    !project.ceremonyClaimBy ||
    project.ceremonyClaimBy === claimant ||
    !project.ceremonyClaimExpiresAt ||
    project.ceremonyClaimExpiresAt < t
  );
}

const CEREMONY_NAMES: Record<Ceremony, string> = {
  kickoff: 'the project kickoff',
  sprint_planning: 'sprint planning',
  sprint_review: 'the sprint review',
};

/** Claim a ceremony for this agent; a new claim is recorded so the Flow view can follow it. */
function claimCeremony(tx: Tx, batch: EventBatch, actor: Actor, project: ProjectRow, ceremony: Ceremony, role: AgentRoleRow): void {
  const claimant = claimantOf(actor);
  const t = now();
  const alreadyMine = project.ceremonyClaimBy === claimant && project.ceremonyClaimExpiresAt != null && project.ceremonyClaimExpiresAt > t;
  if (!alreadyMine) {
    recordActivity(tx, batch, {
      projectId: project.id,
      actor,
      action: 'ceremony.started',
      roleKey: role.key,
      message: `${actorLabel(actor, role.name)} started ${CEREMONY_NAMES[ceremony]}`,
      data: { ceremony },
    });
  }
  tx.update(projects)
    .set({
      ceremonyClaimBy: claimant,
      ceremonyClaimExpiresAt: addMinutes(now(), getSettings().agent.claimTimeoutMinutes),
    })
    .where(eq(projects.id, project.id))
    .run();
}

function releaseCeremony(tx: Tx, projectId: string): void {
  tx.update(projects).set({ ceremonyClaimBy: null, ceremonyClaimExpiresAt: null }).where(eq(projects.id, projectId)).run();
}

// ---------------------------------------------------------------------------
// Next work selection
// ---------------------------------------------------------------------------

/**
 * Decide what the agent should do next, following Scrum:
 *   kickoff → sprint work (pull from the right) → backlog refinement → sprint review → sprint planning.
 * The chosen item or ceremony is claimed for this agent so parallel sessions never collide.
 */
export function getNextWork(actor: Actor, projectId: string): WorkPackage {
  requireProjectAccess(actor, projectId, 'editor');
  if (!getSettings().agent.enabled) {
    return { kind: 'none', status: 'disabled', message: 'An administrator has disabled agent work on this server. Stop and wait.' };
  }
  const batch = new EventBatch();
  const pkg = db.transaction((tx): WorkPackage => {
    const project = getProjectRow(projectId, tx);
    if (project.agentState === 'paused') {
      return {
        kind: 'none',
        status: 'paused',
        message: 'A human paused the agent for this project. Stop working and wait until it is resumed from the board.',
      };
    }
    const claimant = claimantOf(actor);
    const t = now();
    const columns = getColumns(projectId, tx);
    const roles = rolesById(tx);
    const done = columnByKind(columns, 'done');
    const backlog = columnByKind(columns, 'backlog');
    const pm = projectManagerRole(columns, roles);
    const path = workspacePath(tx, project);

    // 1. Kickoff ---------------------------------------------------------------
    if (!project.kickoffCompletedAt) {
      if (!ceremonyAvailable(project, claimant, t)) {
        return { kind: 'none', status: 'waiting', message: 'Another agent session is running the project kickoff.' };
      }
      claimCeremony(tx, batch, actor, project, 'kickoff', pm);
      const existing = tx.select({ n: sql<number>`count(*)` }).from(tasks).where(eq(tasks.projectId, projectId)).get();
      return {
        kind: 'ceremony',
        ceremony: 'kickoff',
        role: pm,
        instructions: kickoffInstructions({ project, role: pm, workspacePath: path, existingItems: Number(existing?.n ?? 0) }),
      };
    }

    // 2. Sprint work -------------------------------------------------------------
    const active = getActiveSprintRow(projectId, tx);
    const inProgress = columnByKind(columns, 'in_progress');
    const inProgressCount = Number(
      tx.select({ n: sql<number>`count(*)` }).from(tasks).where(eq(tasks.columnId, inProgress.id)).get()?.n ?? 0,
    );
    const wipFull = inProgress.wipLimit != null && inProgressCount >= inProgress.wipLimit;
    const workColumnIds = columns
      .filter((c) => SPRINT_WORK_KINDS.includes(c.kind) && !(c.kind === 'todo' && wipFull))
      .map((c) => c.id);

    const sprintCandidates = tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          inArray(tasks.columnId, workColumnIds),
          ne(tasks.type, 'epic'),
          isNull(tasks.assigneeUserId),
          active ? or(isNull(tasks.sprintId), eq(tasks.sprintId, active.id)) : isNull(tasks.sprintId),
          claimFilter(claimant, t),
          dependenciesDone(done.id),
        ),
      )
      .all();
    for (const task of sortCandidates(sprintCandidates, columns, claimant)) {
      const column = columns.find((c) => c.id === task.columnId)!;
      const role = effectiveRole(task, column, roles);
      if (role) return claimTask(tx, batch, actor, project, task, column, role, columns);
    }

    // 3. Backlog refinement ------------------------------------------------------
    const refineRole = effectiveRole({ assignedRoleId: null } as TaskRow, backlog, roles);
    if (refineRole) {
      const toRefine = tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.columnId, backlog.id),
            eq(tasks.refined, false),
            isNull(tasks.assigneeUserId),
            claimFilter(claimant, t),
          ),
        )
        .all();
      const next = sortCandidates(toRefine, columns, claimant)[0];
      if (next) return claimTask(tx, batch, actor, project, next, backlog, refineRole, columns);
    }

    // 4. Sprint review -------------------------------------------------------------
    if (active) {
      const othersWorking = tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.sprintId, active.id),
            sql`${tasks.claimedBy} is not null`,
            ne(tasks.claimedBy, claimant),
            sql`${tasks.claimExpiresAt} > ${t.getTime()}`,
          ),
        )
        .get();
      if (othersWorking || !ceremonyAvailable(project, claimant, t)) {
        return { kind: 'none', status: 'waiting', message: 'Other agent sessions are still working on this sprint.' };
      }
      claimCeremony(tx, batch, actor, project, 'sprint_review', pm);
      const items = tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.sprintId, active.id), ne(tasks.type, 'epic')))
        .orderBy(asc(tasks.number))
        .all()
        .map((r) => ({ ...r, key: formatTaskKey(project.key, r.number) }));
      return {
        kind: 'ceremony',
        ceremony: 'sprint_review',
        role: pm,
        instructions: reviewInstructions({
          project,
          role: pm,
          sprintName: active.name,
          sprintGoal: active.goal,
          done: bulletList(items.filter((i) => i.columnId === done.id)),
          notDone: bulletList(items.filter((i) => i.columnId !== done.id), columns),
        }),
      };
    }

    // 5. Sprint planning -----------------------------------------------------------
    const refined = tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.columnId, backlog.id),
          eq(tasks.refined, true),
          ne(tasks.type, 'epic'),
          isNull(tasks.assigneeUserId),
        ),
      )
      .all();
    if (refined.length > 0 && ceremonyAvailable(project, claimant, t)) {
      claimCeremony(tx, batch, actor, project, 'sprint_planning', pm);
      const carryKinds = new Set(['todo', 'in_progress', 'review', 'testing']);
      const carried = tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.sprintId), ne(tasks.type, 'epic')))
        .all()
        .filter((r) => carryKinds.has(columns.find((c) => c.id === r.columnId)?.kind ?? ''));
      const withKeys = (rows: TaskRow[]) => rows.map((r) => ({ ...r, key: formatTaskKey(project.key, r.number) }));
      return {
        kind: 'ceremony',
        ceremony: 'sprint_planning',
        role: pm,
        instructions: planningInstructions({
          project,
          role: pm,
          candidates: bulletList(withKeys(sortCandidates(refined, columns, claimant))),
          carryOver: bulletList(withKeys(carried), columns),
        }),
      };
    }

    // 6. Nothing to do ---------------------------------------------------------------
    const open = tx
      .select({ id: tasks.id, columnId: tasks.columnId })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), ne(tasks.columnId, done.id), ne(tasks.type, 'epic')))
      .all();
    if (open.length === 0) {
      return {
        kind: 'none',
        status: 'complete',
        message: 'Every work item is done. The project is complete. Add new items to the backlog to continue.',
      };
    }
    const blockedCol = columnByKind(columns, 'blocked');
    const blocked = open.filter((o) => o.columnId === blockedCol.id).length;
    return {
      kind: 'none',
      status: 'waiting',
      message: `Nothing is actionable right now: ${open.length} open item(s)${blocked ? `, ${blocked} waiting in "${blockedCol.name}" for a human answer` : ''}. Other items are assigned to humans, claimed by another session or waiting on dependencies. Check back later.`,
    };
  });
  batch.flush();
  return pkg;
}

// ---------------------------------------------------------------------------
// Agent actions on work items
// ---------------------------------------------------------------------------

function findColumn(columns: ColumnRow[], ref: string): ColumnRow {
  const needle = ref.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const col =
    columns.find((c) => c.kind === needle) ??
    columns.find((c) => c.key.toLowerCase() === needle) ??
    columns.find((c) => c.name.toLowerCase().replace(/[\s/-]+/g, '_') === needle);
  if (!col) {
    throw badRequest(`Unknown column "${ref}". Use one of: ${columns.map((c) => c.kind).join(', ')}`);
  }
  return col;
}

export function moveWorkItem(
  actor: Actor,
  ref: string,
  to: string,
  remark: { body: string; kind: RemarkKind },
  projectId?: string,
): { taskKey: string; column: ColumnRow; escalated: boolean; projectId: string } {
  const task = resolveTaskRef(ref, projectId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const batch = new EventBatch();
  const result = db.transaction((tx) => {
    const columns = getColumns(task.projectId, tx);
    const target = findColumn(columns, to);
    if (target.kind === 'blocked') {
      throw badRequest('Use request_human_input to hand an item to a human; it records your question.');
    }
    const roleKey = task.claimRoleKey;
    return moveTaskTx(tx, batch, actor, task, target.id, { remark, roleKey });
  });
  batch.flush();
  const project = getProjectRow(task.projectId);
  return {
    taskKey: formatTaskKey(project.key, task.number),
    column: result.column,
    escalated: result.escalated,
    projectId: task.projectId,
  };
}

export function markRefined(actor: Actor, ref: string, summary: string, projectId?: string): { taskKey: string; projectId: string } {
  const task = resolveTaskRef(ref, projectId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => {
    const columns = getColumns(task.projectId, tx);
    if (task.columnId !== columnByKind(columns, 'backlog').id) {
      throw badRequest('Only backlog items are refined. Use move_work_item for items on the sprint board.');
    }
    if (task.type !== 'epic' && (task.storyPoints == null || !task.acceptanceCriteria.trim())) {
      throw badRequest('An item needs story points and acceptance criteria before it meets the Definition of Ready.');
    }
    tx.update(tasks)
      .set({ refined: true, ...CLEAR_CLAIM, updatedAt: now() })
      .where(eq(tasks.id, task.id))
      .run();
    insertRemark(tx, batch, actor, task, { body: summary, kind: 'comment', roleKey: task.claimRoleKey ?? 'project_manager' });
    const key = formatTaskKey(getProjectRow(task.projectId, tx).key, task.number);
    recordActivity(tx, batch, {
      projectId: task.projectId,
      actor,
      action: 'task.refined',
      taskId: task.id,
      taskKey: key,
      roleKey: 'project_manager',
      message: `${actorLabel(actor, 'Project Manager')} refined ${key}; it is ready for sprint planning`,
    });
    batch.add(task.projectId, { type: 'task.upserted', task: getTaskDTO(tx, task.id) });
  });
  batch.flush();
  return { taskKey: formatTaskKey(getProjectRow(task.projectId).key, task.number), projectId: task.projectId };
}

export function requestHumanInput(actor: Actor, ref: string, question: string, projectId?: string): { taskKey: string; projectId: string } {
  const task = resolveTaskRef(ref, projectId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => {
    const blocked = columnByKind(getColumns(task.projectId, tx), 'blocked');
    moveTaskTx(tx, batch, actor, task, blocked.id, {
      remark: { body: question, kind: 'question' },
      roleKey: task.claimRoleKey,
    });
  });
  batch.flush();
  return { taskKey: formatTaskKey(getProjectRow(task.projectId).key, task.number), projectId: task.projectId };
}

export function releaseWorkItem(actor: Actor, ref: string, note: string | undefined, projectId?: string): { taskKey: string; projectId: string } {
  const task = resolveTaskRef(ref, projectId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const claimant = claimantOf(actor);
  if (task.claimedBy && task.claimedBy !== claimant && task.claimExpiresAt && task.claimExpiresAt > now()) {
    throw conflict('This item is claimed by another session');
  }
  const batch = new EventBatch();
  db.transaction((tx) => {
    tx.update(tasks)
      .set(CLEAR_CLAIM)
      .where(eq(tasks.id, task.id))
      .run();
    if (note) insertRemark(tx, batch, actor, task, { body: note, kind: 'work_log', roleKey: task.claimRoleKey });
    batch.add(task.projectId, { type: 'task.upserted', task: getTaskDTO(tx, task.id) });
  });
  batch.flush();
  return { taskKey: formatTaskKey(getProjectRow(task.projectId).key, task.number), projectId: task.projectId };
}

export function addAgentRemark(
  actor: Actor,
  ref: string,
  body: string,
  kind: RemarkKind,
  projectId?: string,
): { taskKey: string; projectId: string } {
  const task = resolveTaskRef(ref, projectId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => {
    insertRemark(tx, batch, actor, task, { body, kind, roleKey: task.claimRoleKey });
    batch.add(task.projectId, { type: 'task.upserted', task: getTaskDTO(tx, task.id) });
  });
  batch.flush();
  return { taskKey: formatTaskKey(getProjectRow(task.projectId).key, task.number), projectId: task.projectId };
}

/** Live progress note: shows on the board's activity feed and agent status, without a permanent remark. */
export function logProgress(actor: Actor, projectId: string, message: string, ref?: string): { taskKey: string | null; roleKey: string | null; taskId: string | null } {
  requireProjectAccess(actor, projectId, 'editor');
  const task = ref ? resolveTaskRef(ref, projectId) : undefined;
  const project = getProjectRow(projectId);
  const key = task ? formatTaskKey(project.key, task.number) : null;
  const batch = new EventBatch();
  db.transaction((tx) => {
    recordActivity(tx, batch, {
      projectId,
      actor,
      action: 'agent.progress',
      taskId: task?.id ?? null,
      taskKey: key,
      roleKey: task?.claimRoleKey ?? null,
      message: message.slice(0, 300),
    });
    if (task) {
      // Progress also extends the claim so long-running work is not reclaimed.
      tx.update(tasks)
        .set({ claimExpiresAt: addMinutes(now(), getSettings().agent.claimTimeoutMinutes) })
        .where(and(eq(tasks.id, task.id), eq(tasks.claimedBy, claimantOf(actor))))
        .run();
    }
  });
  batch.flush();
  return { taskKey: key, roleKey: task?.claimRoleKey ?? null, taskId: task?.id ?? null };
}

// ---------------------------------------------------------------------------
// Ceremonies
// ---------------------------------------------------------------------------

export function completeKickoff(actor: Actor, projectId: string, summary: string): void {
  requireProjectAccess(actor, projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => {
    const project = getProjectRow(projectId, tx);
    if (project.kickoffCompletedAt) throw conflict('The kickoff is already complete');
    const items = tx.select({ n: sql<number>`count(*)` }).from(tasks).where(eq(tasks.projectId, projectId)).get();
    if (Number(items?.n ?? 0) === 0) throw badRequest('Create the initial backlog with create_work_items before completing the kickoff.');
    tx.update(projects)
      .set({ kickoffCompletedAt: now(), ceremonyClaimBy: null, ceremonyClaimExpiresAt: null, updatedAt: now() })
      .where(eq(projects.id, projectId))
      .run();
    recordActivity(tx, batch, {
      projectId,
      actor,
      action: 'project.kickoff_completed',
      roleKey: 'project_manager',
      message: `${actorLabel(actor, 'Project Manager')} completed the kickoff: ${summary}`.slice(0, 500),
    });
  });
  batch.flush();
}

export function startSprintFromPlanning(
  actor: Actor,
  projectId: string,
  input: { name?: string; goal: string; items: string[] },
): { sprintName: string; committed: string[]; points: number; capacity: number } {
  requireProjectAccess(actor, projectId, 'editor');
  if (input.items.length === 0) throw badRequest('Select at least one item for the sprint');
  const batch = new EventBatch();
  const result = db.transaction((tx) => {
    const project = getProjectRow(projectId, tx);
    if (getActiveSprintRow(projectId, tx)) throw conflict('A sprint is already active. Complete it first.');
    const backlog = columnByKind(getColumns(projectId, tx), 'backlog');
    const selected = input.items.map((ref) => resolveTaskRef(ref, projectId, tx));
    for (const t of selected) {
      const key = formatTaskKey(project.key, t.number);
      if (t.columnId !== backlog.id) throw badRequest(`${key} is not in the backlog`);
      if (t.type === 'epic') throw badRequest(`${key} is an epic; plan its child stories instead`);
      if (!t.refined) throw badRequest(`${key} is not refined yet (Definition of Ready not met)`);
    }
    const sprint = insertSprint(tx, batch, actor, projectId, { name: input.name, goal: input.goal }, 'project_manager');
    for (const t of selected) tx.update(tasks).set({ sprintId: sprint.id }).where(eq(tasks.id, t.id)).run();
    startSprintTx(tx, batch, actor, tx.select().from(sprints).where(eq(sprints.id, sprint.id)).get()!, 'project_manager');
    releaseCeremony(tx, projectId);
    return {
      sprintName: sprint.name,
      committed: selected.map((t) => formatTaskKey(project.key, t.number)),
      points: selected.reduce((s, t) => s + (t.storyPoints ?? 0), 0),
      capacity: project.sprintCapacity,
    };
  });
  batch.flush();
  return result;
}

export function completeSprintFromReview(
  actor: Actor,
  projectId: string,
  notes: { reviewNotes: string; retroNotes: string },
): { sprintName: string; done: number; total: number } {
  requireProjectAccess(actor, projectId, 'editor');
  const batch = new EventBatch();
  const result = db.transaction((tx) => {
    const active = getActiveSprintRow(projectId, tx);
    if (!active) throw notFound('Active sprint');
    const dto = completeSprintTx(tx, batch, actor, active, notes, 'project_manager');
    releaseCeremony(tx, projectId);
    return { sprintName: dto.name, done: dto.stats.done, total: dto.stats.total };
  });
  batch.flush();
  return result;
}

export function updateProjectNotes(actor: Actor, projectId: string, text: string, mode: 'append' | 'replace'): number {
  requireProjectAccess(actor, projectId, 'editor');
  const project = getProjectRow(projectId);
  const stamp = now().toISOString().slice(0, 16).replace('T', ' ');
  const next = mode === 'replace' ? text : `${project.notes ? `${project.notes}\n\n` : ''}### ${stamp} UTC\n${text}`;
  if (next.length > 100_000) {
    throw badRequest('Project notes would exceed 100,000 characters. Use mode "replace" with a condensed version.');
  }
  const batch = new EventBatch();
  db.transaction((tx) => {
    tx.update(projects).set({ notes: next, updatedAt: now() }).where(eq(projects.id, projectId)).run();
    recordActivity(tx, batch, {
      projectId,
      actor,
      action: 'project.notes_updated',
      message: `${actorLabel(actor)} updated the project notes`,
    });
  });
  batch.flush();
  return next.length;
}

/** Board snapshot for the agent: column counts and the active sprint. */
export function boardSummary(projectId: string): string {
  const columns = getColumns(projectId);
  const counts = db
    .select({ columnId: tasks.columnId, n: sql<number>`count(*)` })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(eq(tasks.projectId, projectId))
    .groupBy(tasks.columnId)
    .all();
  const byColumn = new Map(counts.map((c) => [c.columnId, Number(c.n)]));
  return columns.map((c) => `${c.name} (${c.kind}): ${byColumn.get(c.id) ?? 0}`).join(' | ');
}
