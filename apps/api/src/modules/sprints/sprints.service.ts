import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BurndownPointDTO, SprintDTO } from '@loop/shared';
import { db, type Tx } from '../../db/client';
import { boardColumns, projects, sprints, tasks, type SprintRow } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { now } from '../../lib/time';
import { EventBatch } from '../../realtime/bus';
import { actorLabel, recordActivity } from '../activity/activity.service';
import { requireProjectAccess } from '../projects/access';
import { columnByKind, getColumns } from '../projects/projects.query';
import { getRoleByKey } from '../roles/roles.service';
import { getTaskDTO } from '../tasks/tasks.query';
import { moveTaskTx } from '../tasks/tasks.service';
import { getActiveSprintRow, getSprintDTO, sprintStats, toSprintDTO } from './sprints.query';

const CARRY_OVER_KINDS = ['in_progress', 'review', 'testing', 'blocked'] as const;

function label(actor: Actor | null, roleKey: string | null | undefined, tx: Tx): string {
  return actorLabel(actor, roleKey ? (getRoleByKey(roleKey, tx)?.name ?? null) : null);
}

function publishSprint(tx: Tx, batch: EventBatch, sprintId: string): SprintDTO {
  const dto = getSprintDTO(tx, sprintId)!;
  batch.add(dto.projectId, { type: 'sprint.upserted', sprint: dto });
  return dto;
}

function publishTaskById(tx: Tx, batch: EventBatch, projectId: string, taskId: string): void {
  batch.add(projectId, { type: 'task.upserted', task: getTaskDTO(tx, taskId) });
}

export function getSprintRow(sprintId: string, exec: Tx | typeof db = db): SprintRow {
  const row = exec.select().from(sprints).where(eq(sprints.id, sprintId)).get();
  if (!row) throw notFound('Sprint');
  return row;
}

// ---------------------------------------------------------------------------
// Transaction-level operations (shared by the REST API and the MCP tools)
// ---------------------------------------------------------------------------

export function insertSprint(
  tx: Tx,
  batch: EventBatch,
  actor: Actor,
  projectId: string,
  input: { name?: string; goal: string },
  roleKey?: string | null,
): SprintRow {
  const seq = tx
    .update(projects)
    .set({ sprintSeq: sql`${projects.sprintSeq} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ seq: projects.sprintSeq })
    .get();
  if (!seq) throw notFound('Project');
  const sprint = tx
    .insert(sprints)
    .values({ projectId, number: seq.seq, name: input.name?.trim() || `Sprint ${seq.seq}`, goal: input.goal })
    .returning()
    .get();
  recordActivity(tx, batch, {
    projectId,
    actor,
    action: 'sprint.created',
    roleKey,
    message: `${label(actor, roleKey, tx)} planned ${sprint.name}`,
  });
  publishSprint(tx, batch, sprint.id);
  return sprint;
}

export function startSprintTx(tx: Tx, batch: EventBatch, actor: Actor, sprint: SprintRow, roleKey?: string | null): void {
  if (sprint.status !== 'planned') throw badRequest('Only planned sprints can be started');
  const active = getActiveSprintRow(sprint.projectId, tx);
  if (active) throw conflict(`${active.name} is still active. Complete it before starting a new sprint.`);

  tx.update(sprints).set({ status: 'active', startedAt: now() }).where(eq(sprints.id, sprint.id)).run();

  const columns = getColumns(sprint.projectId, tx);
  const backlog = columnByKind(columns, 'backlog');
  const todo = columnByKind(columns, 'todo');

  // Committed backlog items move onto the sprint board.
  const committed = tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.sprintId, sprint.id), eq(tasks.columnId, backlog.id)))
    .orderBy(asc(tasks.position))
    .all();
  for (const t of committed) moveTaskTx(tx, batch, actor, t, todo.id, { roleKey });

  // Unfinished work carried over from the previous sprint joins this one. Items parked in
  // "Needs Human" during backlog refinement were never sprint work, so they stay out.
  const carryColumns = columns.filter((c) => (CARRY_OVER_KINDS as readonly string[]).includes(c.kind)).map((c) => c.id);
  const blockedColumn = columnByKind(columns, 'blocked');
  const carried = tx
    .select({ id: tasks.id, columnId: tasks.columnId, blockedFromColumnId: tasks.blockedFromColumnId })
    .from(tasks)
    .where(and(eq(tasks.projectId, sprint.projectId), isNull(tasks.sprintId), inArray(tasks.columnId, carryColumns)))
    .all()
    .filter((t) => t.columnId !== blockedColumn.id || (t.blockedFromColumnId !== null && t.blockedFromColumnId !== backlog.id));
  for (const t of carried) {
    tx.update(tasks).set({ sprintId: sprint.id, updatedAt: now() }).where(eq(tasks.id, t.id)).run();
    publishTaskById(tx, batch, sprint.projectId, t.id);
  }

  recordActivity(tx, batch, {
    projectId: sprint.projectId,
    actor,
    action: 'sprint.started',
    roleKey,
    message: `${label(actor, roleKey, tx)} started ${sprint.name}${sprint.goal ? `: ${sprint.goal}` : ''}`,
  });
  publishSprint(tx, batch, sprint.id);
}

export function completeSprintTx(
  tx: Tx,
  batch: EventBatch,
  actor: Actor,
  sprint: SprintRow,
  notes: { reviewNotes: string; retroNotes: string },
  roleKey?: string | null,
): SprintDTO {
  if (sprint.status !== 'active') throw badRequest('Only the active sprint can be completed');
  const columns = getColumns(sprint.projectId, tx);
  const kindOf = new Map(columns.map((c) => [c.id, c.kind]));
  const backlog = columnByKind(columns, 'backlog');

  const items = tx.select().from(tasks).where(eq(tasks.sprintId, sprint.id)).all();
  for (const t of items) {
    const kind = kindOf.get(t.columnId);
    if (kind === 'done') continue;
    if (kind === 'todo') {
      // Not started: back to the product backlog for re-planning (stays refined).
      moveTaskTx(tx, batch, actor, t, backlog.id, { roleKey });
      tx.update(tasks).set({ sprintId: null, refined: true }).where(eq(tasks.id, t.id)).run();
    } else {
      // Started work carries over to the next sprint.
      tx.update(tasks).set({ sprintId: null, updatedAt: now() }).where(eq(tasks.id, t.id)).run();
    }
    publishTaskById(tx, batch, sprint.projectId, t.id);
  }

  tx.update(sprints)
    .set({ status: 'completed', completedAt: now(), reviewNotes: notes.reviewNotes, retroNotes: notes.retroNotes })
    .where(eq(sprints.id, sprint.id))
    .run();

  const dto = publishSprint(tx, batch, sprint.id);
  recordActivity(tx, batch, {
    projectId: sprint.projectId,
    actor,
    action: 'sprint.completed',
    roleKey,
    message: `${label(actor, roleKey, tx)} completed ${sprint.name}: ${dto.stats.done}/${dto.stats.total} items, ${dto.stats.donePoints}/${dto.stats.points} points`,
  });
  return dto;
}

// ---------------------------------------------------------------------------
// Public API (REST)
// ---------------------------------------------------------------------------

export function listSprints(actor: Actor, projectId: string): SprintDTO[] {
  requireProjectAccess(actor, projectId, 'viewer');
  const rows = db.select().from(sprints).where(eq(sprints.projectId, projectId)).orderBy(desc(sprints.number)).all();
  const stats = sprintStats(db, rows.map((r) => r.id));
  return rows.map((r) => toSprintDTO(r, stats.get(r.id)!));
}

export function createSprint(actor: Actor, projectId: string, input: { name: string; goal: string }): SprintDTO {
  requireProjectAccess(actor, projectId, 'editor');
  const batch = new EventBatch();
  const sprint = db.transaction((tx) => insertSprint(tx, batch, actor, projectId, input));
  batch.flush();
  return getSprintDTO(db, sprint.id)!;
}

export function updateSprint(actor: Actor, sprintId: string, patch: { name?: string; goal?: string }): SprintDTO {
  const sprint = getSprintRow(sprintId);
  requireProjectAccess(actor, sprint.projectId, 'editor');
  if (sprint.status === 'completed') throw badRequest('Completed sprints cannot be edited');
  const batch = new EventBatch();
  db.transaction((tx) => {
    tx.update(sprints).set(patch).where(eq(sprints.id, sprintId)).run();
    publishSprint(tx, batch, sprintId);
  });
  batch.flush();
  return getSprintDTO(db, sprintId)!;
}

export function startSprint(actor: Actor, sprintId: string): SprintDTO {
  const sprint = getSprintRow(sprintId);
  requireProjectAccess(actor, sprint.projectId, 'editor');
  const batch = new EventBatch();
  db.transaction((tx) => startSprintTx(tx, batch, actor, sprint));
  batch.flush();
  return getSprintDTO(db, sprintId)!;
}

export function completeSprint(
  actor: Actor,
  sprintId: string,
  notes: { reviewNotes: string; retroNotes: string },
): SprintDTO {
  const sprint = getSprintRow(sprintId);
  requireProjectAccess(actor, sprint.projectId, 'editor');
  const batch = new EventBatch();
  const dto = db.transaction((tx) => completeSprintTx(tx, batch, actor, sprint, notes));
  batch.flush();
  return dto;
}

export function deleteSprint(actor: Actor, sprintId: string): void {
  const sprint = getSprintRow(sprintId);
  requireProjectAccess(actor, sprint.projectId, 'editor');
  if (sprint.status !== 'planned') throw badRequest('Only planned sprints can be deleted');
  const batch = new EventBatch();
  db.transaction((tx) => {
    const members = tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.sprintId, sprintId)).all();
    tx.delete(sprints).where(eq(sprints.id, sprintId)).run();
    for (const t of members) publishTaskById(tx, batch, sprint.projectId, t.id);
    recordActivity(tx, batch, {
      projectId: sprint.projectId,
      actor,
      action: 'sprint.deleted',
      message: `${actorLabel(actor)} deleted ${sprint.name}`,
    });
  });
  batch.flush();
}

/** Remaining story points over time, from sprint start to completion (or now). */
export function getBurndown(actor: Actor, sprintId: string): BurndownPointDTO[] {
  const sprint = getSprintRow(sprintId);
  requireProjectAccess(actor, sprint.projectId, 'viewer');
  const items = db
    .select({ points: tasks.storyPoints, completedAt: tasks.completedAt, kind: boardColumns.kind })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(and(eq(tasks.sprintId, sprintId), sql`${tasks.type} <> 'epic'`))
    .all();
  const start = sprint.startedAt ?? sprint.createdAt;
  const end = sprint.completedAt ?? now();
  let remaining = items.reduce((sum, i) => sum + (i.points ?? 0), 0);
  const points: BurndownPointDTO[] = [{ at: start.toISOString(), remainingPoints: remaining }];
  const completions = items
    .filter((i) => i.kind === 'done' && i.completedAt)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());
  for (const c of completions) {
    remaining -= c.points ?? 0;
    const at = c.completedAt! < start ? start : c.completedAt!;
    points.push({ at: at.toISOString(), remainingPoints: remaining });
  }
  points.push({ at: end.toISOString(), remainingPoints: remaining });
  return points;
}
