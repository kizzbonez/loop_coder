import clsx from 'clsx';
import { CircleCheck, CircleDashed, ListTodo, Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ITEM_TYPES, PRIORITY_RANK, type ItemType, type TaskDTO } from '@loop/shared';
import { PriorityIcon, TypeIcon } from '../../components/board/TaskCard';
import { Badge, Chip } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { EmptyState, ProgressBar } from '../../components/ui/misc';
import { errorMessage } from '../../lib/api';
import { percent } from '../../lib/format';
import { ITEM_TYPE_META } from '../../lib/meta';
import { useSprints, useTaskMutations } from '../../lib/queries';
import { useBoardLookups, useProjectContext, useTaskDrawer, type BoardLookups } from './context';

function Row({
  task,
  lookups,
  selected,
  onSelect,
  selectable,
  onOpen,
}: {
  task: TaskDTO;
  lookups: BoardLookups;
  selected: boolean;
  onSelect: (v: boolean) => void;
  selectable: boolean;
  onOpen: () => void;
}) {
  // In the backlog, show who will build the item (its assigned role) rather than the
  // Project Manager who refines it; on the sprint board, the role working the current stage.
  const inBacklog = lookups.columnsById.get(task.columnId)?.kind === 'backlog';
  const role = inBacklog
    ? task.assignedRoleId
      ? lookups.rolesById.get(task.assignedRoleId)
      : undefined
    : lookups.roleFor(task);
  const epic = task.parentId ? lookups.tasksById.get(task.parentId) : undefined;
  return (
    <li className={clsx('flex items-center gap-3 px-3 py-2 transition hover:bg-surface-2', selected && 'bg-accent-soft')}>
      {selectable ? (
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${task.key}`} className="accent-[var(--accent)]" />
      ) : (
        <span className="w-[13px]" />
      )}
      <TypeIcon type={task.type} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="font-mono text-xs text-subtle">{task.key}</span>
        <span className="truncate text-[13px] font-medium hover:text-accent">{task.title}</span>
      </button>
      {epic && <Chip color="#a855f7" className="hidden max-w-40 md:inline-flex">{epic.title}</Chip>}
      {role && <Chip color={role.color} className="hidden max-w-40 lg:inline-flex">{role.name}</Chip>}
      {task.type !== 'epic' &&
        (task.refined ? (
          <span className="flex items-center gap-1 text-[11px] text-success" title="Meets the Definition of Ready">
            <CircleCheck className="size-3.5" /> Ready
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-warning" title="Needs refinement">
            <CircleDashed className="size-3.5" /> Draft
          </span>
        ))}
      <PriorityIcon priority={task.priority} />
      <span className="w-7 text-right text-xs text-muted tabular-nums">{task.storyPoints ?? '–'}</span>
    </li>
  );
}

export function BacklogView() {
  const { project, tasks, roles, canEdit } = useProjectContext();
  const lookups = useBoardLookups(project, tasks, roles);
  const { openTask } = useTaskDrawer();
  const m = useTaskMutations(project.id);
  const sprints = useSprints(project.id);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ItemType>('story');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetSprint, setTargetSprint] = useState('');
  const [epicFilter, setEpicFilter] = useState('');

  const backlogCol = lookups.columnByKind('backlog');
  const blockedCol = lookups.columnByKind('blocked');
  const byPriority = (a: TaskDTO, b: TaskDTO) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.position - b.position;

  const { epics, backlog, sprintItems, needsHuman } = useMemo(() => {
    const inEpic = (t: TaskDTO) => !epicFilter || t.parentId === epicFilter;
    return {
      epics: tasks.filter((t) => t.type === 'epic'),
      backlog: tasks.filter((t) => t.columnId === backlogCol?.id && t.type !== 'epic' && inEpic(t)).sort(byPriority),
      sprintItems: project.activeSprint ? tasks.filter((t) => t.sprintId === project.activeSprint!.id && inEpic(t)).sort(byPriority) : [],
      needsHuman: tasks.filter((t) => t.columnId === blockedCol?.id),
    };
  }, [tasks, backlogCol?.id, blockedCol?.id, project.activeSprint, epicFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSprints = (sprints.data ?? []).filter((s) => s.status !== 'completed');
  const ready = backlog.filter((t) => t.refined);
  const toggle = (id: string, v: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });

  const assignSelected = async () => {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => m.update.mutateAsync({ id, input: { sprintId: targetSprint } })));
      toast.success(`Added ${ids.length} item(s) to the sprint`);
      setSelected(new Set());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {canEdit && (
        <form
          className="card flex flex-wrap items-center gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            m.create.mutate({ title: title.trim(), type }, { onSuccess: () => setTitle(''), onError: (err) => toast.error(errorMessage(err)) });
          }}
        >
          <Select value={type} onChange={(e) => setType(e.target.value as ItemType)} className="w-28" aria-label="Type">
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_META[t].label}
              </option>
            ))}
          </Select>
          <Input placeholder="Add an idea, story or bug. The agent refines it into a ready story." value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-60 flex-1" aria-label="Title" />
          <Button type="submit" variant="primary" icon={Plus} disabled={!title.trim()} loading={m.create.isPending}>
            Add to backlog
          </Button>
        </form>
      )}

      {needsHuman.length > 0 && (
        <section className="rounded-xl border border-danger/40 bg-danger/5">
          <h3 className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-danger">
            <TriangleAlert className="size-4" /> Waiting for your answer ({needsHuman.length})
          </h3>
          <ul className="divide-y divide-line py-1">
            {needsHuman.map((t) => (
              <Row key={t.id} task={t} lookups={lookups} selected={false} selectable={false} onSelect={() => undefined} onOpen={() => openTask(t.id)} />
            ))}
          </ul>
        </section>
      )}

      {epics.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wider text-subtle uppercase">Epics</h3>
            {epicFilter && (
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => setEpicFilter('')}>
                Show all
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {epics.map((epic) => {
              const children = tasks.filter((t) => t.parentId === epic.id);
              const done = children.filter((c) => c.columnId === lookups.doneColumnId).length;
              return (
                <button
                  key={epic.id}
                  type="button"
                  onClick={() => setEpicFilter(epicFilter === epic.id ? '' : epic.id)}
                  onDoubleClick={() => openTask(epic.id)}
                  className={clsx('card p-3 text-left transition hover:border-line-strong', epicFilter === epic.id && 'border-accent ring-2 ring-[var(--ring)]')}
                  title="Click to filter, double-click to open"
                >
                  <div className="flex items-center gap-2 text-xs text-subtle">
                    <TypeIcon type="epic" /> <span className="font-mono">{epic.key}</span>
                    <span className="ml-auto tabular-nums">
                      {done}/{children.length}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[13px] font-medium">{epic.title}</div>
                  <ProgressBar className="mt-2" value={percent(done, children.length)} />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {project.activeSprint && (
        <section className="card overflow-hidden">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold">{project.activeSprint.name}</h3>
            <Badge tone="success">Active</Badge>
            <span className="ml-auto text-xs text-muted">{sprintItems.length} items</span>
          </header>
          <ul className="divide-y divide-line">
            {sprintItems.map((t) => (
              <Row key={t.id} task={t} lookups={lookups} selected={false} selectable={false} onSelect={() => undefined} onOpen={() => openTask(t.id)} />
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">Product backlog</h3>
          <span className="text-xs text-muted">
            {backlog.length} items · {ready.length} ready · {ready.reduce((s, t) => s + (t.storyPoints ?? 0), 0)} ready points
          </span>
          {canEdit && selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <Select value={targetSprint} onChange={(e) => setTargetSprint(e.target.value)} className="h-8 w-44 py-1 text-[13px]" aria-label="Target sprint">
                <option value="">Choose a sprint…</option>
                {openSprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.status === 'active' ? '(active)' : ''}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="primary" disabled={!targetSprint} onClick={() => void assignSelected()}>
                Add {selected.size} to sprint
              </Button>
            </div>
          )}
        </header>
        {backlog.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ListTodo} title="The backlog is empty" description={project.kickoffCompletedAt ? 'Add ideas above or let the agent create items during refinement.' : 'The agent builds the initial backlog during the project kickoff.'} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {backlog.map((t) => (
              <Row
                key={t.id}
                task={t}
                lookups={lookups}
                selectable={canEdit && t.refined}
                selected={selected.has(t.id)}
                onSelect={(v) => toggle(t.id, v)}
                onOpen={() => openTask(t.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
