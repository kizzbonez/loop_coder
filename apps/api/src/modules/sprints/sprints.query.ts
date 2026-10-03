import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SprintDTO, SprintStatsDTO } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import { boardColumns, sprints, tasks, type SprintRow } from '../../db/schema';

export function getActiveSprintRow(projectId: string, exec: Executor = db): SprintRow | undefined {
  return exec
    .select()
    .from(sprints)
    .where(and(eq(sprints.projectId, projectId), eq(sprints.status, 'active')))
    .get();
}

export function sprintStats(exec: Executor, sprintIds: string[]): Map<string, SprintStatsDTO> {
  const result = new Map<string, SprintStatsDTO>(
    sprintIds.map((id) => [id, { total: 0, done: 0, points: 0, donePoints: 0 }]),
  );
  if (sprintIds.length === 0) return result;
  const rows = exec
    .select({
      sprintId: tasks.sprintId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${boardColumns.kind} = 'done' then 1 else 0 end)`,
      points: sql<number>`coalesce(sum(${tasks.storyPoints}), 0)`,
      donePoints: sql<number>`coalesce(sum(case when ${boardColumns.kind} = 'done' then ${tasks.storyPoints} else 0 end), 0)`,
    })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(and(inArray(tasks.sprintId, sprintIds), ne(tasks.type, 'epic')))
    .groupBy(tasks.sprintId)
    .all();
  for (const r of rows) {
    if (!r.sprintId) continue;
    result.set(r.sprintId, {
      total: Number(r.total),
      done: Number(r.done ?? 0),
      points: Number(r.points ?? 0),
      donePoints: Number(r.donePoints ?? 0),
    });
  }
  return result;
}

export function toSprintDTO(s: SprintRow, stats: SprintStatsDTO): SprintDTO {
  return {
    id: s.id,
    projectId: s.projectId,
    number: s.number,
    name: s.name,
    goal: s.goal,
    status: s.status,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    reviewNotes: s.reviewNotes,
    retroNotes: s.retroNotes,
    createdAt: s.createdAt.toISOString(),
    stats,
  };
}

export function getSprintDTO(exec: Executor, sprintId: string): SprintDTO | null {
  const row = exec.select().from(sprints).where(eq(sprints.id, sprintId)).get();
  return row ? toSprintDTO(row, sprintStats(exec, [row.id]).get(row.id)!) : null;
}

export function getActiveSprintDTO(projectId: string, exec: Executor = db): SprintDTO | null {
  const row = getActiveSprintRow(projectId, exec);
  return row ? toSprintDTO(row, sprintStats(exec, [row.id]).get(row.id)!) : null;
}
