import type { TaskDTO } from '@loop/shared';

export type ColumnItems = Record<string, string[]>;

/** Group work items by column, ordered by position. */
export function groupByColumn(tasks: TaskDTO[], columnIds: string[]): ColumnItems {
  const groups: ColumnItems = Object.fromEntries(columnIds.map((id) => [id, [] as string[]]));
  for (const t of [...tasks].sort((a, b) => a.position - b.position)) {
    (groups[t.columnId] ??= []).push(t.id);
  }
  return groups;
}

export function findContainer(items: ColumnItems, id: string): string | undefined {
  if (id in items) return id;
  return Object.keys(items).find((col) => items[col]!.includes(id));
}

/**
 * Translate a drop position within a (possibly filtered) column into the index within the
 * full column the server knows about: we place the item before its next visible neighbour.
 */
export function serverIndex(visibleOrder: string[], movedId: string, fullOrder: string[]): number {
  const full = fullOrder.filter((id) => id !== movedId);
  const at = visibleOrder.indexOf(movedId);
  const next = visibleOrder.slice(at + 1).find((id) => full.includes(id));
  return next ? full.indexOf(next) : full.length;
}

/** Optimistic fractional position matching what the server will compute. */
export function positionBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 1024;
  if (prev === undefined) return next! - 1024;
  if (next === undefined) return prev + 1024;
  return (prev + next) / 2;
}

export interface TaskFilter {
  query: string;
  type: string;
  sprintOnly: boolean;
  activeSprintId: string | null;
}

export function matchesFilter(task: TaskDTO, f: TaskFilter): boolean {
  if (f.type && task.type !== f.type) return false;
  if (f.sprintOnly && f.activeSprintId && task.sprintId !== f.activeSprintId) return false;
  const q = f.query.trim().toLowerCase();
  if (q && !task.title.toLowerCase().includes(q) && !task.key.toLowerCase().includes(q) && !task.labels.some((l) => l.toLowerCase().includes(q))) {
    return false;
  }
  return true;
}
