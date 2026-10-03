import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  createTaskSchema,
  formatTaskKey,
  SPRINT_WORK_KINDS,
  updateTaskSchema,
  type CreateRemarkInput,
  type CreateTaskInput,
  type RemarkDTO,
  type RemarkKind,
  type TaskDetailDTO,
  type TaskDTO,
  type UpdateTaskInput,
} from '@loop/shared';
import type { z } from 'zod';
import { db, type Tx } from '../../db/client';
import {
  agentRoles,
  projects,
  sprints,
  taskDependencies,
  taskRemarks,
  tasks,
  workspaceMembers,
  type ColumnRow,
  type TaskRow,
} from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { badRequest, notFound } from '../../lib/errors';
import { now } from '../../lib/time';
import { EventBatch } from '../../realtime/bus';
import { actorLabel, agentNameOf, recordActivity } from '../activity/activity.service';
import { requireProjectAccess } from '../projects/access';
import { columnByKind, getColumns, getProjectRow } from '../projects/projects.query';
import { getRoleByKey } from '../roles/roles.service';
import { getSettings } from '../settings/settings.service';
import { getActiveSprintRow } from '../sprints/sprints.query';
import {
  getTaskDTO,
  getTaskRow,
  listProjectTaskDTOs,
  listRemarks,
  toRemarkDTO,
} from './tasks.query';

type CreateTaskData = z.output<typeof createTaskSchema>;
type UpdateTaskData = z.output<typeof updateTaskSchema>;
type TaskUpdate = Partial<typeof tasks.$inferInsert>;

const POSITION_GAP = 1024;

/** Column values that release an agent's claim on a work item. */
export const CLEAR_CLAIM = {
  claimedBy: null,
  claimAgentName: null,
  claimRoleKey: null,
  claimedAt: null,
  claimExpiresAt: null,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roleName = (roleKey: string | null | undefined, tx: Tx) =>
  roleKey ? (getRoleByKey(roleKey, tx)?.name ?? roleKey) : null;

function keyOf(tx: Tx, task: Pick<TaskRow, 'projectId' | 'number'>): string {
  return formatTaskKey(getProjectRow(task.projectId, tx).key, task.number);
}

function publishTask(tx: Tx, batch: EventBatch, taskId: string): void {
  const dto = getTaskDTO(tx, taskId);
  batch.add(dto.projectId, { type: 'task.upserted', task: dto });
}

function nextItemNumber(tx: Tx, projectId: string): number {
  const row = tx
    .update(projects)
    .set({ itemSeq: sql`${projects.itemSeq} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ seq: projects.itemSeq })
    .get();
  if (!row) throw notFound('Project');
  return row.seq;
}

function endPosition(tx: Tx, columnId: string): number {
  const row = tx
    .select({ max: sql<number | null>`max(${tasks.position})` })
    .from(tasks)
    .where(eq(tasks.columnId, columnId))
    .get();
  return (row?.max ?? 0) + POSITION_GAP;
}

/** Fractional position for inserting at `index` within a column; renumbers when gaps run out. */
function positionAt(tx: Tx, batch: EventBatch, columnId: string, index: number, excludeId: string): number {
  const rows = tx
    .select({ id: tasks.id, position: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.columnId, columnId), ne(tasks.id, excludeId)))
    .orderBy(asc(tasks.position))
    .all();
  if (rows.length === 0) return POSITION_GAP;
  const i = Math.min(Math.max(index, 0), rows.length);
  if (i === 0) return rows[0]!.position - POSITION_GAP;
  if (i === rows.length) return rows[rows.length - 1]!.position + POSITION_GAP;
  const prev = rows[i - 1]!.position;
  const next = rows[i]!.position;
  if (next - prev > 1e-6) return (prev + next) / 2;

  rows.forEach((r, idx) => {
    const position = (idx + (idx >= i ? 2 : 1)) * POSITION_GAP;
    tx.update(tasks).set({ position }).where(eq(tasks.id, r.id)).run();
    publishTask(tx, batch, r.id);
  });
  return (i + 1) * POSITION_GAP;
}

function activeSprintId(tx: Tx, projectId: string): string | null {
  return getActiveSprintRow(projectId, tx)?.id ?? null;
}

/** Depth-first search: would `taskId` → `dependsOnId` close a cycle? */
function createsCycle(tx: Tx, taskId: string, dependsOnId: string): boolean {
  const stack = [dependsOnId];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const d of tx
      .select({ id: taskDependencies.dependsOnId })
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, current))
      .all()) {
      stack.push(d.id);
    }
  }
  return false;
}

function setDependencies(tx: Tx, task: Pick<TaskRow, 'id' | 'projectId'>, dependsOn: string[]): void {
  const ids = [...new Set(dependsOn)];
  if (ids.includes(task.id)) throw badRequest('A work item cannot depend on itself');
  if (ids.length) {
    const found = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(inArray(tasks.id, ids), eq(tasks.projectId, task.projectId)))
      .all();
    if (found.length !== ids.length) throw badRequest('Dependencies must be work items of the same project');
  }
  tx.delete(taskDependencies).where(eq(taskDependencies.taskId, task.id)).run();
  for (const dep of ids) {
    if (createsCycle(tx, task.id, dep)) throw badRequest('That dependency would create a cycle');
    tx.insert(taskDependencies).values({ taskId: task.id, dependsOnId: dep }).run();
  }
}

function validateRefs(
  tx: Tx,
  projectId: string,
  data: Partial<Pick<CreateTaskData, 'parentId' | 'sprintId' | 'assignedRoleId' | 'assigneeUserId'>>,
  selfId?: string,
): void {
  if (data.parentId) {
    if (data.parentId === selfId) throw badRequest('A work item cannot be its own parent');
    const parent = tx.select().from(tasks).where(eq(tasks.id, data.parentId)).get();
    if (!parent || parent.projectId !== projectId) throw badRequest('Parent must be a work item of the same project');
    if (parent.type !== 'epic') throw badRequest('Only epics can have child items');
  }
  if (data.sprintId) {
    const sprint = tx.select().from(sprints).where(eq(sprints.id, data.sprintId)).get();
    if (!sprint || sprint.projectId !== projectId) throw badRequest('Sprint must belong to the same project');
    if (sprint.status === 'completed') throw badRequest('Cannot add items to a completed sprint');
  }
  if (data.assignedRoleId) {
    const role = tx.select().from(agentRoles).where(eq(agentRoles.id, data.assignedRoleId)).get();
    if (!role) throw badRequest('Unknown agent role');
  }
  if (data.assigneeUserId) {
    const project = getProjectRow(projectId, tx);
    const member = tx
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, project.workspaceId), eq(workspaceMembers.userId, data.assigneeUserId)))
      .get();
    if (!member) throw badRequest('Assignee must be a member of the workspace');
  }
}

/**
 * Epics finish automatically when all their children are done, and re-open when a child
 * leaves Done again.
 */
function syncEpic(tx: Tx, batch: EventBatch, epicId: string | null, columns: ColumnRow[]): void {
  if (!epicId) return;
  const epic = tx.select().from(tasks).where(eq(tasks.id, epicId)).get();
  if (!epic || epic.type !== 'epic') return;
  const children = tx.select({ columnId: tasks.columnId }).from(tasks).where(eq(tasks.parentId, epicId)).all();
  if (children.length === 0) return;
  const done = columnByKind(columns, 'done');
  const backlog = columnByKind(columns, 'backlog');
  const allDone = children.every((c) => c.columnId === done.id);
  const key = keyOf(tx, epic);

  if (allDone && epic.columnId !== done.id) {
    tx.update(tasks)
      .set({ columnId: done.id, position: endPosition(tx, done.id), completedAt: now(), updatedAt: now() })
      .where(eq(tasks.id, epicId))
      .run();
    recordActivity(tx, batch, {
      projectId: epic.projectId,
      actor: null,
      action: 'task.moved',
      taskId: epic.id,
      taskKey: key,
      message: `Epic ${key} completed: all child items are done`,
      data: { to: 'done' },
    });
    publishTask(tx, batch, epicId);
  } else if (!allDone && epic.columnId === done.id) {
    tx.update(tasks)
      .set({ columnId: backlog.id, position: endPosition(tx, backlog.id), completedAt: null, updatedAt: now() })
      .where(eq(tasks.id, epicId))
      .run();
    recordActivity(tx, batch, {
      projectId: epic.projectId,
      actor: null,
      action: 'task.moved',
      taskId: epic.id,
      taskKey: key,
      message: `Epic ${key} re-opened: a child item is no longer done`,
      data: { to: 'backlog' },
    });
    publishTask(tx, batch, epicId);
  }
}

// ---------------------------------------------------------------------------
// Remarks
// ---------------------------------------------------------------------------

export function insertRemark(
  tx: Tx,
  batch: EventBatch,
  actor: Actor | null,
  task: Pick<TaskRow, 'id' | 'projectId'>,
  input: { body: string; kind: RemarkKind; roleKey?: string | null },
): RemarkDTO {
  const row = tx
    .insert(taskRemarks)
    .values({
      taskId: task.id,
      projectId: task.projectId,
      authorType: actor ? (actor.kind === 'agent' ? 'agent' : 'user') : 'system',
      authorUserId: actor?.userId ?? null,
      agentName: agentNameOf(actor),
      roleKey: input.roleKey ?? null,
      kind: input.kind,
      body: input.body,
    })
    .returning()
    .get();
  const dto = toRemarkDTO(row, actor?.name ?? null);
  batch.add(task.projectId, { type: 'remark.created', remark: dto });
  return dto;
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export function insertTask(
  tx: Tx,
  batch: EventBatch,
  actor: Actor,
  projectId: string,
  data: CreateTaskData,
  roleKey: string | null = null,
): TaskRow {
  const columns = getColumns(projectId, tx);
  const column = data.columnId ? columns.find((c) => c.id === data.columnId) : columnByKind(columns, 'backlog');
  if (!column) throw badRequest('Unknown column for this project');
  validateRefs(tx, projectId, data);

  let sprintId = data.sprintId ?? null;
  if (!sprintId && SPRINT_WORK_KINDS.includes(column.kind)) sprintId = activeSprintId(tx, projectId);

  const number = nextItemNumber(tx, projectId);
  const row = tx
    .insert(tasks)
    .values({
      projectId,
      number,
      type: data.type,
      title: data.title,
      description: data.description,
      acceptanceCriteria: data.acceptanceCriteria,
      priority: data.priority,
      storyPoints: data.storyPoints ?? null,
      columnId: column.id,
      position: endPosition(tx, column.id),
      parentId: data.parentId ?? null,
      sprintId,
      assignedRoleId: data.assignedRoleId ?? null,
      assigneeUserId: data.assigneeUserId ?? null,
      labels: data.labels,
      refined: data.refined,
      createdByUserId: actor.userId,
      createdByAgent: actor.kind === 'agent',
      completedAt: column.kind === 'done' ? now() : null,
    })
    .returning()
    .get();
  if (data.dependsOn.length) setDependencies(tx, row, data.dependsOn);

  const key = keyOf(tx, row);
  recordActivity(tx, batch, {
    projectId,
    actor,
    action: 'task.created',
    taskId: row.id,
    taskKey: key,
    roleKey,
    message: `${actorLabel(actor, roleName(roleKey, tx))} created ${key} "${row.title}"`,
  });
  publishTask(tx, batch, row.id);
  syncEpic(tx, batch, row.parentId, columns);
  return row;
}

export function createTask(actor: Actor, projectId: string, input: CreateTaskInput): TaskDTO {
  requireProjectAccess(actor, projectId, 'editor');
  const data = createTaskSchema.parse(input);
  const batch = new EventBatch();
  const row = db.transaction((tx) => insertTask(tx, batch, actor, projectId, data));
  batch.flush();
  return getTaskDTO(db, row.id);
}

export function applyTaskUpdate(
  tx: Tx,
  batch: EventBatch,
  actor: Actor,
  task: TaskRow,
  data: UpdateTaskData,
  roleKey: string | null = null,
  /** Skip the activity entry (used when wiring up items that were just created). */
  silent = false,
): void {
  validateRefs(tx, task.projectId, data, task.id);
  const columns = getColumns(task.projectId, tx);
  const { dependsOn, ...fields } = data;
  const update: TaskUpdate = { ...fields, updatedAt: now() };

  if (data.type && data.type !== 'epic' && task.type === 'epic') {
    const child = tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, task.id)).get();
    if (child) throw badRequest('This epic still has child items; re-parent them before changing its type');
  }

  // Adding an item to / removing it from the running sprint moves it on the board.
  if (data.sprintId !== undefined && data.sprintId !== task.sprintId) {
    const active = activeSprintId(tx, task.projectId);
    const backlog = columnByKind(columns, 'backlog');
    const todo = columnByKind(columns, 'todo');
    if (data.sprintId && data.sprintId === active && task.columnId === backlog.id) {
      Object.assign(update, { columnId: todo.id, position: endPosition(tx, todo.id) });
    } else if (!data.sprintId && task.columnId === todo.id) {
      Object.assign(update, { columnId: backlog.id, position: endPosition(tx, backlog.id) });
    }
  }

  tx.update(tasks).set(update).where(eq(tasks.id, task.id)).run();
  if (dependsOn) setDependencies(tx, task, dependsOn);

  if (!silent) {
    const changed = Object.keys(data);
    const key = keyOf(tx, task);
    recordActivity(tx, batch, {
      projectId: task.projectId,
      actor,
      action: 'task.updated',
      taskId: task.id,
      taskKey: key,
      roleKey,
      message: `${actorLabel(actor, roleName(roleKey, tx))} updated ${key} (${changed.join(', ')})`,
      data: { fields: changed },
    });
  }
  publishTask(tx, batch, task.id);
  if (data.parentId !== undefined && data.parentId !== task.parentId) {
    syncEpic(tx, batch, task.parentId, columns);
    syncEpic(tx, batch, data.parentId, columns);
  }
}

export function updateTask(actor: Actor, taskId: string, input: UpdateTaskInput): TaskDTO {
  const task = getTaskRow(taskId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const data = updateTaskSchema.parse(input);
  if (Object.keys(data).length === 0) return getTaskDTO(db, taskId);
  const batch = new EventBatch();
  db.transaction((tx) => applyTaskUpdate(tx, batch, actor, task, data));
  batch.flush();
  return getTaskDTO(db, taskId);
}

// ---------------------------------------------------------------------------
// Moving through the workflow
// ---------------------------------------------------------------------------

export interface MoveOptions {
  /** Index within the target column; defaults to the end. */
  index?: number;
  remark?: { body: string; kind: RemarkKind };
  /** Agent role performing the move (used for labels and remarks). */
  roleKey?: string | null;
}

export interface MoveResult {
  escalated: boolean;
  column: ColumnRow;
}

export function moveTaskTx(
  tx: Tx,
  batch: EventBatch,
  actor: Actor | null,
  task: TaskRow,
  toColumnId: string,
  opts: MoveOptions = {},
): MoveResult {
  const columns = getColumns(task.projectId, tx);
  const from = columns.find((c) => c.id === task.columnId)!;
  let target = columns.find((c) => c.id === toColumnId);
  if (!target) throw badRequest('Unknown column for this project');

  // Rework loop: review/QA sending an item back to development.
  const rework =
    (from.kind === 'review' || from.kind === 'testing') && (target.kind === 'todo' || target.kind === 'in_progress');
  let bounceCount = task.bounceCount;
  let escalated = false;
  const maxBounces = getSettings().agent.maxBounces;
  if (rework) {
    bounceCount += 1;
    if (actor?.kind === 'agent' && bounceCount > maxBounces) {
      target = columnByKind(columns, 'blocked');
      escalated = true;
    }
  }

  const sameColumn = target.id === from.id;
  const position =
    opts.index !== undefined
      ? positionAt(tx, batch, target.id, opts.index, task.id)
      : sameColumn
        ? task.position
        : endPosition(tx, target.id);

  const update: TaskUpdate = { columnId: target.id, position, bounceCount, updatedAt: now() };
  if (!sameColumn) {
    // Any stage change ends the current claim.
    Object.assign(update, CLEAR_CLAIM);
    update.completedAt = target.kind === 'done' ? now() : null;
    if (target.kind === 'blocked') {
      update.blockedFromColumnId = from.kind === 'blocked' ? task.blockedFromColumnId : from.id;
    } else {
      update.blockedFromColumnId = null;
    }
    const active = getActiveSprintRow(task.projectId, tx);
    if (SPRINT_WORK_KINDS.includes(target.kind) && !task.sprintId && active) update.sprintId = active.id;
    if (target.kind === 'backlog' && task.sprintId && active && task.sprintId === active.id) update.sprintId = null;
  }
  tx.update(tasks).set(update).where(eq(tasks.id, task.id)).run();

  const key = keyOf(tx, task);
  const label = actorLabel(actor, roleName(opts.roleKey, tx));
  if (opts.remark) insertRemark(tx, batch, actor, task, { ...opts.remark, roleKey: opts.roleKey });
  if (escalated) {
    insertRemark(tx, batch, null, task, {
      kind: 'system',
      body: `Escalated to a human: this item was sent back for rework ${bounceCount} times (limit ${maxBounces}). Review the remarks above, decide how to proceed, then answer with "resume" or move the item yourself.`,
    });
  }
  if (!sameColumn) {
    recordActivity(tx, batch, {
      projectId: task.projectId,
      actor,
      action: escalated ? 'task.escalated' : 'task.moved',
      taskId: task.id,
      taskKey: key,
      roleKey: opts.roleKey ?? null,
      message: escalated
        ? `${key} escalated to ${target.name} after ${bounceCount} rework cycles`
        : `${label} moved ${key} from ${from.name} to ${target.name}`,
      data: { from: from.kind, to: target.kind },
    });
  }
  publishTask(tx, batch, task.id);
  if (!sameColumn && (target.kind === 'done' || from.kind === 'done')) syncEpic(tx, batch, task.parentId, columns);
  return { escalated, column: target };
}

export function moveTask(actor: Actor, taskId: string, toColumnId: string, index?: number): TaskDTO {
  const task = getTaskRow(taskId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => moveTaskTx(tx, batch, actor, task, toColumnId, { index }));
  batch.flush();
  return getTaskDTO(db, taskId);
}

// ---------------------------------------------------------------------------
// Delete / read / comment
// ---------------------------------------------------------------------------

export function deleteTask(actor: Actor, taskId: string): void {
  const task = getTaskRow(taskId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => {
    const key = keyOf(tx, task);
    const children = tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, taskId)).all();
    tx.delete(tasks).where(eq(tasks.id, taskId)).run();
    for (const child of children) publishTask(tx, batch, child.id);
    recordActivity(tx, batch, {
      projectId: task.projectId,
      actor,
      action: 'task.deleted',
      taskKey: key,
      message: `${actorLabel(actor)} deleted ${key} "${task.title}"`,
    });
    batch.add(task.projectId, { type: 'task.deleted', taskId });
    syncEpic(tx, batch, task.parentId, getColumns(task.projectId, tx));
  });
  batch.flush();
}

export function listTasks(actor: Actor, projectId: string): TaskDTO[] {
  requireProjectAccess(actor, projectId, 'viewer');
  return listProjectTaskDTOs(projectId);
}

export function getTaskDetail(actor: Actor, taskId: string): TaskDetailDTO {
  const task = getTaskRow(taskId);
  requireProjectAccess(actor, task.projectId, 'viewer');
  return { ...getTaskDTO(db, taskId), remarks: listRemarks(taskId) };
}

/**
 * Human comment from the UI. When answering an item in "Needs Human" with `resume`, it goes
 * back to the stage it was blocked from so the agent picks it up again.
 */
export function addHumanRemark(actor: Actor, taskId: string, input: CreateRemarkInput & { kind: 'comment' | 'answer'; resume: boolean }): TaskDetailDTO {
  const task = getTaskRow(taskId);
  requireProjectAccess(actor, task.projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => {
    insertRemark(tx, batch, actor, task, { body: input.body, kind: input.kind });
    const key = keyOf(tx, task);
    recordActivity(tx, batch, {
      projectId: task.projectId,
      actor,
      action: 'remark.created',
      taskId: task.id,
      taskKey: key,
      message: `${actorLabel(actor)} ${input.kind === 'answer' ? 'answered on' : 'commented on'} ${key}`,
    });
    const columns = getColumns(task.projectId, tx);
    const blocked = columnByKind(columns, 'blocked');
    if (input.resume && task.columnId === blocked.id) {
      const back = columns.find((c) => c.id === task.blockedFromColumnId) ?? columnByKind(columns, 'backlog');
      moveTaskTx(tx, batch, actor, task, back.id);
      // A human decision resets the rework counter.
      tx.update(tasks).set({ bounceCount: 0 }).where(eq(tasks.id, task.id)).run();
    }
    publishTask(tx, batch, task.id);
  });
  batch.flush();
  return getTaskDetail(actor, taskId);
}
