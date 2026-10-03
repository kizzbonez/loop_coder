import clsx from 'clsx';
import { ChevronDown, Flag, Pencil, Play, Plus, Rocket, Target, Trash } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { SprintDTO } from '@loop/shared';
import { BurndownChart } from '../../components/charts/BurndownChart';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Textarea } from '../../components/ui/Field';
import { Markdown } from '../../components/ui/Markdown';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, PageLoader, ProgressBar } from '../../components/ui/misc';
import { errorMessage } from '../../lib/api';
import { formatDate, percent, pluralize } from '../../lib/format';
import { useBurndown, useSprintMutations, useSprints } from '../../lib/queries';
import { useProjectContext } from './context';

function SprintStats({ sprint }: { sprint: SprintDTO }) {
  const { stats } = sprint;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
      <span className="tabular-nums">
        <b className="text-fg">{stats.done}</b>/{stats.total} items
      </span>
      <span className="tabular-nums">
        <b className="text-fg">{stats.donePoints}</b>/{stats.points} points
      </span>
      {sprint.startedAt && <span>Started {formatDate(sprint.startedAt)}</span>}
      {sprint.completedAt && <span>Completed {formatDate(sprint.completedAt)}</span>}
    </div>
  );
}

function SprintFormModal({
  open,
  onClose,
  initial,
  onSubmit,
  pending,
  title,
}: {
  open: boolean;
  onClose: () => void;
  initial: { name: string; goal: string };
  onSubmit: (v: { name: string; goal: string }) => void;
  pending: boolean;
  title: string;
}) {
  const [form, setForm] = useState(initial);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={!form.name.trim()} onClick={() => onSubmit(form)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Textarea label="Sprint goal" rows={3} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} hint="One clear outcome the sprint delivers." />
      </div>
    </Modal>
  );
}

function CompleteSprintModal({ sprint, open, onClose }: { sprint: SprintDTO; open: boolean; onClose: () => void }) {
  const { project } = useProjectContext();
  const m = useSprintMutations(project.id);
  const [reviewNotes, setReview] = useState('');
  const [retroNotes, setRetro] = useState('');
  const unfinished = sprint.stats.total - sprint.stats.done;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Complete ${sprint.name}`}
      description={
        unfinished > 0
          ? `${pluralize(unfinished, 'item')} not done: unstarted items return to the backlog, started ones carry over to the next sprint.`
          : 'Everything was delivered.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Flag}
            loading={m.complete.isPending}
            onClick={() =>
              m.complete.mutate(
                { id: sprint.id, reviewNotes, retroNotes },
                { onSuccess: () => (toast.success(`${sprint.name} completed`), onClose()), onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          >
            Complete sprint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea label="Sprint review" rows={4} placeholder="What was delivered against the goal?" value={reviewNotes} onChange={(e) => setReview(e.target.value)} />
        <Textarea label="Retrospective" rows={4} placeholder="What went well, what to improve, action items" value={retroNotes} onChange={(e) => setRetro(e.target.value)} />
      </div>
    </Modal>
  );
}

function ActiveSprint({ sprint }: { sprint: SprintDTO }) {
  const { canEdit, project } = useProjectContext();
  const burndown = useBurndown(sprint.id);
  const m = useSprintMutations(project.id);
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <section className="card relative overflow-hidden p-5">
      <div className="brand-gradient absolute inset-x-0 top-0 h-0.5" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge tone="success">Active</Badge>
            <h2 className="text-lg font-semibold">{sprint.name}</h2>
            {canEdit && <IconButton icon={Pencil} size="sm" label="Edit sprint" onClick={() => setEditing(true)} />}
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-[13px] text-muted">
            <Target className="mt-0.5 size-3.5 shrink-0 text-accent" />
            {sprint.goal || 'No sprint goal recorded.'}
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" icon={Flag} onClick={() => setCompleting(true)}>
            Complete sprint
          </Button>
        )}
      </div>
      <div className="mt-4 space-y-2">
        <ProgressBar value={percent(sprint.stats.donePoints, sprint.stats.points)} />
        <SprintStats sprint={sprint} />
      </div>
      <div className="mt-5">{burndown.data && burndown.data.length > 1 ? <BurndownChart points={burndown.data} /> : <p className="text-xs text-subtle">The burndown appears once the sprint has estimated items.</p>}</div>
      <CompleteSprintModal sprint={sprint} open={completing} onClose={() => setCompleting(false)} />
      {editing && (
        <SprintFormModal
          open
          title="Edit sprint"
          initial={{ name: sprint.name, goal: sprint.goal }}
          pending={m.update.isPending}
          onClose={() => setEditing(false)}
          onSubmit={(input) => m.update.mutate({ id: sprint.id, input }, { onSuccess: () => setEditing(false), onError: (e) => toast.error(errorMessage(e)) })}
        />
      )}
    </section>
  );
}

function CompletedSprint({ sprint }: { sprint: SprintDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
        <ChevronDown className={clsx('size-4 text-subtle transition', !open && '-rotate-90')} />
        <span className="font-medium">{sprint.name}</span>
        <span className="hidden truncate text-[13px] text-muted sm:inline">{sprint.goal}</span>
        <span className="ml-auto text-xs text-muted tabular-nums">
          {sprint.stats.done}/{sprint.stats.total} · {sprint.stats.donePoints} pts
        </span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-line p-4 md:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-xs font-semibold tracking-wider text-subtle uppercase">Sprint review</h4>
            {sprint.reviewNotes ? <Markdown>{sprint.reviewNotes}</Markdown> : <p className="text-[13px] text-subtle">No notes.</p>}
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold tracking-wider text-subtle uppercase">Retrospective</h4>
            {sprint.retroNotes ? <Markdown>{sprint.retroNotes}</Markdown> : <p className="text-[13px] text-subtle">No notes.</p>}
          </div>
          <div className="md:col-span-2">
            <SprintStats sprint={sprint} />
          </div>
        </div>
      )}
    </li>
  );
}

export function SprintsView() {
  const { project, canEdit } = useProjectContext();
  const sprints = useSprints(project.id);
  const m = useSprintMutations(project.id);
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SprintDTO | null>(null);

  if (sprints.isPending) return <PageLoader />;
  const list = sprints.data ?? [];
  const active = list.find((s) => s.status === 'active');
  const planned = list.filter((s) => s.status === 'planned');
  const completed = list.filter((s) => s.status === 'completed');
  const velocity = completed.slice(0, 3);
  const avgVelocity = velocity.length ? Math.round(velocity.reduce((s, x) => s + x.stats.donePoints, 0) / velocity.length) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-base font-semibold">Sprints</h2>
          <p className="text-[13px] text-muted">
            Capacity {project.sprintCapacity} points{avgVelocity != null && <> · velocity (last {velocity.length}) {avgVelocity} points</>}
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" icon={Plus} className="ml-auto" onClick={() => setCreating(true)}>
            Plan a sprint
          </Button>
        )}
      </div>

      {active ? (
        <ActiveSprint sprint={active} />
      ) : (
        <EmptyState
          icon={Rocket}
          title="No active sprint"
          description="The agent runs sprint planning automatically once refined backlog items exist. You can also plan one yourself: create a sprint, assign refined items to it from the backlog, then start it."
        />
      )}

      {planned.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-subtle uppercase">Planned</h3>
          <ul className="space-y-2">
            {planned.map((s) => (
              <li key={s.id} className="card flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="truncate text-[13px] text-muted">
                    {s.goal || 'No goal yet'} · {pluralize(s.stats.total, 'item')}, {s.stats.points} pts
                  </div>
                </div>
                {canEdit && (
                  <>
                    <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(s)} />
                    <IconButton
                      icon={Trash}
                      tone="danger"
                      label="Delete"
                      onClick={async () => {
                        if (await confirm({ title: `Delete ${s.name}?`, message: 'Its items go back to having no sprint.', danger: true, confirmLabel: 'Delete' })) {
                          m.remove.mutate(s.id, { onError: (e) => toast.error(errorMessage(e)) });
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Play}
                      disabled={Boolean(active)}
                      title={active ? 'Complete the active sprint first' : undefined}
                      onClick={() => m.start.mutate(s.id, { onSuccess: () => toast.success(`${s.name} started`), onError: (e) => toast.error(errorMessage(e)) })}
                    >
                      Start
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-subtle uppercase">Completed</h3>
          <ul className="space-y-2">
            {completed.map((s) => (
              <CompletedSprint key={s.id} sprint={s} />
            ))}
          </ul>
        </section>
      )}

      {creating && (
        <SprintFormModal
          open
          title="Plan a sprint"
          initial={{ name: `Sprint ${list.length + 1}`, goal: '' }}
          pending={m.create.isPending}
          onClose={() => setCreating(false)}
          onSubmit={(v) => m.create.mutate(v, { onSuccess: () => setCreating(false), onError: (e) => toast.error(errorMessage(e)) })}
        />
      )}
      {editing && (
        <SprintFormModal
          open
          title="Edit sprint"
          initial={{ name: editing.name, goal: editing.goal }}
          pending={m.update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(input) => m.update.mutate({ id: editing.id, input }, { onSuccess: () => setEditing(null), onError: (e) => toast.error(errorMessage(e)) })}
        />
      )}
    </div>
  );
}
