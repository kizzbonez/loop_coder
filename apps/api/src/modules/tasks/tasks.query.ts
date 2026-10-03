import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { RemarkDTO, TaskDTO } from '@loop/shared';
import { formatTaskKey, GENERIC_AGENT_NAME } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import { projects, taskRemarks, tasks, users, type RemarkRow, type TaskRow } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { isUuid } from '../../lib/http';

const taskSelection = {
  task: tasks,
  projectKey: projects.key,
  dependsOnJson: sql<string>`(select json_group_array(d.depends_on_id) from task_dependencies d where d.task_id = ${tasks.id})`,
  remarkCount: sql<number>`(select count(*) from task_remarks r where r.task_id = ${tasks.id})`,
};

type TaskSelectionRow = {
  task: TaskRow;
  projectKey: string;
  dependsOnJson: string;
  remarkCount: number;
};

export function toTaskDTO(row: TaskSelectionRow): TaskDTO {
  const t = row.task;
  const claimActive = t.claimedBy && t.claimExpiresAt && t.claimExpiresAt > new Date();
  return {
    id: t.id,
    projectId: t.projectId,
    key: formatTaskKey(row.projectKey, t.number),
    number: t.number,
    type: t.type,
    title: t.title,
    description: t.description,
    acceptanceCriteria: t.acceptanceCriteria,
    priority: t.priority,
    storyPoints: t.storyPoints,
    columnId: t.columnId,
    position: t.position,
    parentId: t.parentId,
    sprintId: t.sprintId,
    assignedRoleId: t.assignedRoleId,
    assigneeUserId: t.assigneeUserId,
    labels: t.labels ?? [],
    refined: t.refined,
    bounceCount: t.bounceCount,
    dependsOn: JSON.parse(row.dependsOnJson || '[]') as string[],
    claim: claimActive
      ? {
          by: t.claimedBy!,
          agentName: t.claimAgentName ?? GENERIC_AGENT_NAME,
          roleKey: t.claimRoleKey,
          at: (t.claimedAt ?? t.updatedAt).toISOString(),
          expiresAt: t.claimExpiresAt!.toISOString(),
        }
      : null,
    createdByAgent: t.createdByAgent,
    remarkCount: Number(row.remarkCount),
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function selectTasks(exec: Executor) {
  return exec.select(taskSelection).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId));
}

export function queryTaskDTOs(exec: Executor, where: SQL | undefined): TaskDTO[] {
  return selectTasks(exec)
    .where(where)
    .orderBy(asc(tasks.position))
    .all()
    .map((r) => toTaskDTO(r as TaskSelectionRow));
}

export function getTaskDTO(exec: Executor, taskId: string): TaskDTO {
  const row = selectTasks(exec).where(eq(tasks.id, taskId)).get();
  if (!row) throw notFound('Work item');
  return toTaskDTO(row as TaskSelectionRow);
}

export function listProjectTaskDTOs(projectId: string, exec: Executor = db): TaskDTO[] {
  return queryTaskDTOs(exec, eq(tasks.projectId, projectId));
}

export function getTaskRow(taskId: string, exec: Executor = db): TaskRow {
  const row = exec.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw notFound('Work item');
  return row;
}

/**
 * Resolve a work-item reference: either its UUID or its human key (e.g. "SHOP-12").
 * When `projectId` is given the item must belong to that project.
 */
export function resolveTaskRef(ref: string, projectId?: string, exec: Executor = db): TaskRow {
  const trimmed = ref.trim();
  let row: TaskRow | undefined;
  if (isUuid(trimmed)) {
    row = exec.select().from(tasks).where(eq(tasks.id, trimmed.toLowerCase())).get();
  } else {
    const match = /^([A-Za-z][A-Za-z0-9]{1,7})-(\d{1,7})$/.exec(trimmed);
    if (match) {
      const found = exec
        .select({ task: tasks })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(projects.key, match[1]!.toUpperCase()), eq(tasks.number, Number(match[2]))))
        .get();
      row = found?.task;
    }
  }
  if (!row || (projectId && row.projectId !== projectId)) throw notFound(`Work item "${ref}"`);
  return row;
}

export function toRemarkDTO(r: RemarkRow, authorName: string | null): RemarkDTO {
  return {
    id: r.id,
    taskId: r.taskId,
    projectId: r.projectId,
    authorType: r.authorType,
    authorUserId: r.authorUserId,
    authorName: r.authorType === 'agent' ? (r.agentName ?? GENERIC_AGENT_NAME) : r.authorType === 'system' ? 'System' : authorName,
    roleKey: r.roleKey,
    kind: r.kind,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  };
}

export function listRemarks(taskId: string, exec: Executor = db): RemarkDTO[] {
  return exec
    .select({ remark: taskRemarks, authorName: users.name })
    .from(taskRemarks)
    .leftJoin(users, eq(users.id, taskRemarks.authorUserId))
    .where(eq(taskRemarks.taskId, taskId))
    // rowid breaks ties between remarks written within the same millisecond.
    .orderBy(asc(taskRemarks.createdAt), sql`task_remarks.rowid`)
    .all()
    .map(({ remark, authorName }) => toRemarkDTO(remark, authorName));
}
