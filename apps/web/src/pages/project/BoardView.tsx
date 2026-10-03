import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type HTMLAttributes } from 'react';
import { toast } from 'sonner';
import { ITEM_TYPES, type ColumnDTO, type ItemType, type TaskDTO } from '@loop/shared';
import { TaskCard } from '../../components/board/TaskCard';
import { Chip } from '../../components/ui/Badge';
import { IconButton } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { errorMessage } from '../../lib/api';
import { findContainer, groupByColumn, matchesFilter, positionBetween, serverIndex, type ColumnItems } from '../../lib/board';
import { ITEM_TYPE_META } from '../../lib/meta';
import { keys, useMembers, useTaskMutations } from '../../lib/queries';
import { useBoardLookups, useProjectContext, useTaskDrawer, type BoardLookups } from './context';

function SortableCard({ task, lookups, onOpen, disabled, assigneeName }: { task: TaskDTO; lookups: BoardLookups; onOpen: () => void; disabled: boolean; assigneeName?: string | null }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  // Drag props go onto the card itself (not a wrapper) so there is one focusable button, not two nested ones.
  const { role: _role, tabIndex: _tabIndex, ...dragAttributes } = attributes;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <TaskCard
        dragProps={{ ...dragAttributes, ...(listeners as HTMLAttributes<HTMLDivElement>) }}
        task={task}
        role={lookups.roleFor(task)}
        blockedBy={lookups.openDependencies(task)}
        epic={task.parentId ? lookups.tasksById.get(task.parentId) : undefined}
        assigneeName={assigneeName}
        onOpen={onOpen}
        dragging={isDragging}
      />
    </div>
  );
}

function QuickAdd({ column, onDone }: { column: ColumnDTO; onDone: () => void }) {
  const { project } = useProjectContext();
  const { create } = useTaskMutations(project.id);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ItemType>('story');
  return (
    <form
      className="rounded-xl border border-accent/40 bg-surface p-2 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        create.mutate(
          { title: title.trim(), type, columnId: column.id },
          { onSuccess: () => setTitle(''), onError: (err) => toast.error(errorMessage(err)) },
        );
      }}
    >
      <Input autoFocus placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onDone()} />
      <div className="mt-2 flex items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value as ItemType)} className="h-8 w-28 py-1 text-xs" aria-label="Type">
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_META[t].label}
            </option>
          ))}
        </Select>
        <button type="button" onClick={onDone} className="ml-auto text-xs text-muted hover:text-fg">
          Close
        </button>
        <button type="submit" className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg disabled:opacity-50" disabled={!title.trim() || create.isPending}>
          Add
        </button>
      </div>
    </form>
  );
}

function Column({
  column,
  ids,
  total,
  lookups,
  canEdit,
  onOpen,
  memberNames,
}: {
  column: ColumnDTO;
  ids: string[];
  total: number;
  lookups: BoardLookups;
  canEdit: boolean;
  onOpen: (id: string) => void;
  memberNames: Map<string, string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !canEdit });
  const [adding, setAdding] = useState(false);
  const role = column.agentRoleId ? lookups.rolesById.get(column.agentRoleId) : undefined;
  const overWip = column.wipLimit != null && total > column.wipLimit;
  const color = column.color ?? '#64748b';

  return (
    <section className="flex w-[300px] shrink-0 flex-col rounded-2xl bg-surface-2/70 dark:bg-surface/60" aria-label={column.name}>
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
          <h2 className="truncate text-[13px] font-semibold">{column.name}</h2>
          <span className={clsx('rounded-full px-1.5 text-[11px] font-medium tabular-nums', overWip ? 'bg-danger/15 text-danger' : 'bg-surface-3 text-muted')}>
            {total}
            {column.wipLimit != null && `/${column.wipLimit}`}
          </span>
          {canEdit && <IconButton icon={Plus} size="sm" label={`Add to ${column.name}`} className="ml-auto" onClick={() => setAdding(true)} />}
        </div>
        <div className="mt-1.5 flex h-5 items-center gap-1.5">
          {column.roleSource === 'task' ? (
            <>
              {role && (
                <Chip color={role.color} dot>
                  {role.name}
                </Chip>
              )}
              <span className="truncate text-[11px] text-subtle" title="Each item may name its own role (designer, architect, DevOps…); this is the default">
                {role ? 'or the item’s role' : 'Item’s assigned role'}
              </span>
            </>
          ) : role ? (
            <Chip color={role.color} dot>
              {role.name}
            </Chip>
          ) : (
            <span className="text-[11px] text-subtle">{column.kind === 'blocked' ? 'Waiting for a human answer' : column.kind === 'done' ? 'Meets the Definition of Done' : 'Humans only'}</span>
          )}
        </div>
      </header>
      <div ref={setNodeRef} className={clsx('flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 transition', isOver && 'rounded-xl bg-accent-soft')}>
        {adding && <QuickAdd column={column} onDone={() => setAdding(false)} />}
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const task = lookups.tasksById.get(id);
            return task ? (
              <SortableCard
                key={id}
                task={task}
                lookups={lookups}
                disabled={!canEdit}
                onOpen={() => onOpen(id)}
                assigneeName={task.assigneeUserId ? memberNames.get(task.assigneeUserId) : null}
              />
            ) : null;
          })}
        </SortableContext>
        {ids.length === 0 && !adding && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line-strong py-8 text-xs text-subtle">
            {column.kind === 'blocked' ? 'Nothing needs you' : 'No items'}
          </div>
        )}
      </div>
    </section>
  );
}

export function BoardView() {
  const { project, tasks, roles, canEdit } = useProjectContext();
  const lookups = useBoardLookups(project, tasks, roles);
  const { openTask } = useTaskDrawer();
  const { move } = useTaskMutations(project.id);
  const members = useMembers(project.workspaceId);
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ query: '', type: '', sprintOnly: false });
  const [activeId, setActiveId] = useState<string | null>(null);
  const columnIds = project.columns.map((c) => c.id);

  const memberNames = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m.name])), [members.data]);
  const fullOrder = useMemo(() => groupByColumn(tasks, columnIds), [tasks, columnIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => {
    const f = { ...filter, activeSprintId: project.activeSprint?.id ?? null };
    return groupByColumn(
      tasks.filter((t) => matchesFilter(t, f)),
      columnIds,
    );
  }, [tasks, filter, project.activeSprint?.id, columnIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Local ordering while dragging; otherwise mirror the server state (which streams in live).
  const [items, setItems] = useState<ColumnItems>(visible);
  useEffect(() => {
    if (!activeId) setItems(visible);
  }, [visible, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks up / drops a card; Enter stays free to open it.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findContainer(items, String(active.id));
    const to = findContainer(items, String(over.id));
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const source = prev[from]!.filter((id) => id !== active.id);
      const target = prev[to]!.slice();
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id));
      return { ...prev, [from]: source, [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    setActiveId(null);
    if (!over) return setItems(visible);
    const container = findContainer(items, id);
    if (!container) return;
    let order = items[container]!;
    const overIndex = order.indexOf(String(over.id));
    const currentIndex = order.indexOf(id);
    if (overIndex >= 0 && overIndex !== currentIndex) order = arrayMove(order, currentIndex, overIndex);

    const task = lookups.tasksById.get(id);
    if (!task) return;
    const full = fullOrder[container] ?? [];
    const index = serverIndex(order, id, full);
    // Dropped back where it was: nothing to save.
    if (task.columnId === container && full.indexOf(id) === index) return setItems(visible);

    // Optimistic update so the card stays where it was dropped.
    const siblings = full.filter((x) => x !== id).map((x) => lookups.tasksById.get(x)!);
    const position = positionBetween(siblings[index - 1]?.position, siblings[index]?.position);
    qc.setQueryData<TaskDTO[]>(keys.tasks(project.id), (old) => old?.map((t) => (t.id === id ? { ...t, columnId: container, position } : t)));
    move.mutate(
      { id, columnId: container, index },
      { onError: (err) => toast.error(errorMessage(err)) },
    );
  };

  const activeTask = activeId ? lookups.tasksById.get(activeId) : undefined;

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle" />
          <Input placeholder="Filter items" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} className="pl-9" aria-label="Filter items" />
        </div>
        <Select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className="w-36" aria-label="Item type">
          <option value="">All types</option>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_META[t].label}
            </option>
          ))}
        </Select>
        {project.activeSprint && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted select-none">
            <input type="checkbox" checked={filter.sprintOnly} onChange={(e) => setFilter({ ...filter, sprintOnly: e.target.checked })} className="accent-[var(--accent)]" />
            Current sprint only
          </label>
        )}
        {!canEdit && <span className="ml-auto text-xs text-subtle">Read-only access</span>}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 sm:px-6">
          {project.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              ids={items[column.id] ?? []}
              total={(fullOrder[column.id] ?? []).length}
              lookups={lookups}
              canEdit={canEdit}
              onOpen={openTask}
              memberNames={memberNames}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} role={lookups.roleFor(activeTask)} blockedBy={lookups.openDependencies(activeTask)} onOpen={() => undefined} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
