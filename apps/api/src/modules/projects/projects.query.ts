import { asc, eq } from 'drizzle-orm';
import type { ColumnDTO, ColumnKind } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import { boardColumns, projects, type ColumnRow, type ProjectRow } from '../../db/schema';
import { notFound } from '../../lib/errors';

export function getProjectRow(id: string, exec: Executor = db): ProjectRow {
  const row = exec.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) throw notFound('Project');
  return row;
}

export function getProjectByKey(key: string, exec: Executor = db): ProjectRow | undefined {
  return exec.select().from(projects).where(eq(projects.key, key.toUpperCase())).get();
}

export function getColumns(projectId: string, exec: Executor = db): ColumnRow[] {
  return exec
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.position))
    .all();
}

export function columnByKind(columns: ColumnRow[], kind: ColumnKind): ColumnRow {
  const col = columns.find((c) => c.kind === kind);
  if (!col) throw new Error(`Project board is missing its "${kind}" column`);
  return col;
}

export function toColumnDTO(c: ColumnRow): ColumnDTO {
  return {
    id: c.id,
    projectId: c.projectId,
    key: c.key,
    name: c.name,
    kind: c.kind,
    position: c.position,
    agentRoleId: c.agentRoleId,
    roleSource: c.roleSource,
    wipLimit: c.wipLimit,
    color: c.color,
  };
}
