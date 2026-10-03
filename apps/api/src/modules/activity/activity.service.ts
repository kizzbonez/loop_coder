import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { GENERIC_AGENT_NAME, type ActivityDTO } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import { activities, users, type ActivityRow } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import type { EventBatch } from '../../realtime/bus';

export interface ActivityInput {
  projectId: string;
  actor: Actor | null;
  action: string;
  message: string;
  taskId?: string | null;
  taskKey?: string | null;
  roleKey?: string | null;
  data?: Record<string, unknown>;
}

/** Name of the agent behind an actor (the MCP client's friendly name), or null for humans. */
export function agentNameOf(actor: Actor | null): string | null {
  return actor?.kind === 'agent' ? (actor.agentName ?? GENERIC_AGENT_NAME) : null;
}

export function actorLabel(actor: Actor | null, roleName?: string | null): string {
  if (!actor) return 'System';
  const agent = agentNameOf(actor);
  if (agent) return roleName ? `${agent} (${roleName})` : agent;
  return actor.name;
}

function toDTO(row: ActivityRow, actorName: string | null): ActivityDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    taskKey: row.taskKey,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    actorName: row.actorType === 'agent' ? (row.agentName ?? GENERIC_AGENT_NAME) : actorName,
    roleKey: row.roleKey,
    action: row.action,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

export function recordActivity(exec: Executor, batch: EventBatch, input: ActivityInput): void {
  const row = exec
    .insert(activities)
    .values({
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      taskKey: input.taskKey ?? null,
      actorType: input.actor ? (input.actor.kind === 'agent' ? 'agent' : 'user') : 'system',
      actorUserId: input.actor?.userId ?? null,
      agentName: agentNameOf(input.actor),
      roleKey: input.roleKey ?? null,
      action: input.action,
      message: input.message.slice(0, 500),
      data: input.data ?? null,
    })
    .returning()
    .get();
  batch.add(input.projectId, { type: 'activity.created', activity: toDTO(row, input.actor?.name ?? null) });
}

export function listActivity(projectId: string, limit: number, before?: Date): ActivityDTO[] {
  const where = before
    ? and(eq(activities.projectId, projectId), lt(activities.createdAt, before))
    : eq(activities.projectId, projectId);
  return db
    .select({ row: activities, actorName: users.name })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorUserId))
    .where(where)
    .orderBy(desc(activities.createdAt), sql`activities.rowid desc`)
    .limit(limit)
    .all()
    .map(({ row, actorName }) => toDTO(row, actorName));
}
