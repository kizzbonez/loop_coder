import clsx from 'clsx';
import { Bot, Check, CircleCheck, Link2, Lock, Pencil, Play, Route, Send, Trash, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ITEM_TYPES,
  PRIORITIES,
  STORY_POINTS,
  type RemarkDTO,
  type TaskDetailDTO,
  type UpdateTaskInput,
} from '@loop/shared';
import { errorMessage } from '../../lib/api';
import { formatDateTime, timeAgo } from '../../lib/format';
import { ITEM_TYPE_META, PRIORITY_META, REMARK_KIND_META } from '../../lib/meta';
import { useMembers, useSprints, useTask, useTaskMutations } from '../../lib/queries';
import type { BoardLookups, ProjectContext } from '../../pages/project/context';
import { Badge, Chip } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { Input, Select, Switch, Textarea } from '../ui/Field';
import { Markdown } from '../ui/Markdown';
import { Drawer } from '../ui/Modal';
import { Avatar, PageLoader } from '../ui/misc';
import { TypeIcon } from './TaskCard';

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function EditableMarkdown({
  title,
  value,
  placeholder,
  canEdit,
  onSave,
}: {
  title: string;
  value: string;
  placeholder: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-subtle uppercase">{title}</h3>
        {canEdit && !editing && <IconButton icon={Pencil} size="sm" label={`Edit ${title.toLowerCase()}`} onClick={() => setEditing(true)} />}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus className="font-mono text-[13px]" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" icon={Check} onClick={() => onSave(draft).then(() => setEditing(false))}>
              Save
            </Button>
          </div>
        </div>
      ) : value ? (
        <Markdown>{value}</Markdown>
      ) : (
        <p className="text-[13px] text-subtle italic">{placeholder}</p>
      )}
    </section>
  );
}

function RemarkItem({ remark, roleColor, roleName }: { remark: RemarkDTO; roleColor?: string; roleName?: string }) {
  const kind = REMARK_KIND_META[remark.kind];
  const isAgent = remark.authorType === 'agent';
  return (
    <li className="flex gap-3">
      {isAgent ? (
        <span className="brand-gradient flex size-8 shrink-0 items-center justify-center rounded-full text-white">
          <Bot className="size-4" />
        </span>
      ) : remark.authorType === 'system' ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-muted">
          <Lock className="size-4" />
        </span>
      ) : (
        <Avatar name={remark.authorName} />
      )}
      <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2/60 p-3" style={roleColor ? { borderLeft: `3px solid ${roleColor}` } : undefined}>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-fg">{remark.authorName}</span>
          {roleName && roleColor && <Chip color={roleColor}>{roleName}</Chip>}
          <Chip color={kind.color}>{kind.label}</Chip>
          <span className="ml-auto text-subtle" title={formatDateTime(remark.createdAt)}>
            {timeAgo(remark.createdAt)}
          </span>
        </div>
        <Markdown>{remark.body}</Markdown>
      </div>
    </li>
  );
}

export function TaskDrawer({
  ctx,
  lookups,
  taskId,
  onClose,
  onOpenTask,
}: {
  ctx: ProjectContext;
  lookups: BoardLookups;
  taskId: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const { project, tasks, roles, canEdit } = ctx;
  const detail = useTask(taskId);
  const m = useTaskMutations(project.id);
  const members = useMembers(project.workspaceId);
  const sprints = useSprints(project.id);
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  const [labels, setLabels] = useState('');
  const [comment, setComment] = useState('');
  const [depToAdd, setDepToAdd] = useState('');

  const task = detail.data;
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setLabels(task.labels.join(', '));
    }
  }, [task?.id, task?.title, task?.labels.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (input: UpdateTaskInput) =>
    m.update.mutateAsync({ id: taskId, input }).catch((e) => {
      toast.error(errorMessage(e));
      throw e;
    });

  if (detail.isError) {
    return (
      <Drawer open onClose={onClose} label="Work item">
        <div className="p-6 text-sm text-muted">This work item no longer exists.</div>
      </Drawer>
    );
  }

  return (
    <Drawer open onClose={onClose} label={task ? `${task.key} ${task.title}` : 'Work item'}>
      {!task ? (
        <PageLoader />
      ) : (
        <TaskBody
          task={task}
          {...{ ctx, lookups, canEdit, title, setTitle, labels, setLabels, comment, setComment, depToAdd, setDepToAdd, save, onClose, onOpenTask }}
          members={members.data ?? []}
          sprints={(sprints.data ?? []).filter((s) => s.status !== 'completed' || s.id === task.sprintId)}
          onMove={(columnId) => m.move.mutate({ id: task.id, columnId, index: 9999 }, { onError: (e) => toast.error(errorMessage(e)) })}
          onRemark={(kind, resume) =>
            m.remark.mutate(
              { id: task.id, body: comment.trim(), kind, resume },
              {
                onSuccess: () => {
                  setComment('');
                  if (resume) toast.success('Answered. The item is back in the workflow for the agent.');
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
          remarkPending={m.remark.isPending}
          onDelete={async () => {
            if (await confirm({ title: `Delete ${task.key}?`, message: 'The item and its remarks are removed permanently.', danger: true, confirmLabel: 'Delete' })) {
              m.remove.mutate(task.id, { onSuccess: onClose, onError: (e) => toast.error(errorMessage(e)) });
            }
          }}
          epics={tasks.filter((t) => t.type === 'epic' && t.id !== task.id)}
          roles={roles}
        />
      )}
    </Drawer>
  );
}

function TaskBody({
  task,
  ctx,
  lookups,
  canEdit,
  title,
  setTitle,
  labels,
  setLabels,
  comment,
  setComment,
  depToAdd,
  setDepToAdd,
  save,
  onClose,
  onOpenTask,
  members,
  sprints,
  onMove,
  onRemark,
  remarkPending,
  onDelete,
  epics,
  roles,
}: {
  task: TaskDetailDTO;
  ctx: ProjectContext;
  lookups: BoardLookups;
  canEdit: boolean;
  title: string;
  setTitle: (v: string) => void;
  labels: string;
  setLabels: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  depToAdd: string;
  setDepToAdd: (v: string) => void;
  save: (input: UpdateTaskInput) => Promise<unknown>;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  members: Array<{ userId: string; name: string }>;
  sprints: Array<{ id: string; name: string; status: string }>;
  onMove: (columnId: string) => void;
  onRemark: (kind: 'comment' | 'answer', resume: boolean) => void;
  remarkPending: boolean;
  onDelete: () => void;
  epics: Array<{ id: string; key: string; title: string }>;
  roles: ProjectContext['roles'];
}) {
  const { project, tasks } = ctx;
  const column = lookups.columnsById.get(task.columnId);
  const role = lookups.roleFor(task);
  const isBlocked = column?.kind === 'blocked';
  const children = tasks.filter((t) => t.parentId === task.id);
  const deps = task.dependsOn.map((id) => lookups.tasksById.get(id)).filter(Boolean) as typeof tasks;
  const depCandidates = tasks.filter((t) => t.id !== task.id && t.type !== 'epic' && !task.dependsOn.includes(t.id));
  const navigate = useNavigate();

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            <TypeIcon type={task.type} />
            <span className="font-mono">{task.key}</span>
            {column && <Chip color={column.color ?? '#64748b'} dot>{column.name}</Chip>}
            {task.claim && role && (
              <Badge tone="accent">
                <Bot className="size-3" /> {task.claim.agentName} · {role.name}
              </Badge>
            )}
          </div>
          <input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && void save({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="mt-1.5 w-full rounded-md bg-transparent text-lg font-semibold outline-none focus:bg-surface-2 focus:px-2 disabled:text-fg"
            aria-label="Title"
          />
        </div>
        <IconButton icon={Route} label="Replay journey" title="Replay this item's journey through the flow" onClick={() => navigate(`/p/${task.projectId}/flow?replay=${task.id}`)} />
        {canEdit && <IconButton icon={Trash} tone="danger" label="Delete work item" onClick={onDelete} />}
        <IconButton icon={X} label="Close" onClick={onClose} />
      </header>

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_340px]">
        <div className="space-y-7 px-5 py-5 lg:border-r lg:border-line">
          {isBlocked && (
            <div className="rounded-xl border border-danger/40 bg-danger/8 p-4 text-[13px]">
              <p className="font-semibold text-danger">The agent needs your input</p>
              <p className="mt-1 text-muted">Read the question below, then answer with “Answer &amp; resume” to send the item back into the workflow.</p>
            </div>
          )}

          <EditableMarkdown title="Description" value={task.description} placeholder="No description." canEdit={canEdit} onSave={(v) => save({ description: v })} />
          <EditableMarkdown
            title="Acceptance criteria"
            value={task.acceptanceCriteria}
            placeholder="No acceptance criteria yet. They are added during refinement."
            canEdit={canEdit}
            onSave={(v) => save({ acceptanceCriteria: v })}
          />

          {children.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wider text-subtle uppercase">Child items ({children.length})</h3>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {children.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpenTask(c.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                      <TypeIcon type={c.type} />
                      <span className="font-mono text-xs text-subtle">{c.key}</span>
                      <span className="truncate">{c.title}</span>
                      {c.columnId === lookups.doneColumnId ? <CircleCheck className="ml-auto size-4 text-success" /> : (
                        <span className="ml-auto text-xs text-muted">{lookups.columnsById.get(c.columnId)?.name}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-3 text-xs font-semibold tracking-wider text-subtle uppercase">Remarks &amp; history ({task.remarks.length})</h3>
            {task.remarks.length === 0 ? (
              <p className="text-[13px] text-subtle">No remarks yet. The agent records its work, reviews and test reports here.</p>
            ) : (
              <ol className="space-y-3">
                {task.remarks.map((r) => {
                  const rr = r.roleKey ? lookups.rolesByKey.get(r.roleKey) : undefined;
                  return <RemarkItem key={r.id} remark={r} roleColor={rr?.color} roleName={rr?.name} />;
                })}
              </ol>
            )}
            {canEdit && (
              <form
                className="mt-4 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim()) onRemark('comment', false);
                }}
              >
                <Textarea
                  rows={3}
                  placeholder={isBlocked ? 'Answer the agent’s question…' : 'Add a comment for the agent or your team (markdown supported)'}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && comment.trim()) onRemark(isBlocked ? 'answer' : 'comment', isBlocked);
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button type="submit" size="sm" variant={isBlocked ? 'ghost' : 'primary'} icon={Send} disabled={!comment.trim()} loading={remarkPending && !isBlocked}>
                    Comment
                  </Button>
                  {isBlocked && (
                    <Button size="sm" variant="primary" icon={Play} disabled={!comment.trim()} loading={remarkPending} onClick={() => onRemark('answer', true)}>
                      Answer &amp; resume
                    </Button>
                  )}
                </div>
              </form>
            )}
          </section>
        </div>

        <aside className="space-y-5 bg-surface-2/40 px-5 py-5">
          <div>
            <Prop label="Stage">
              <Select value={task.columnId} disabled={!canEdit} onChange={(e) => onMove(e.target.value)} className="h-8 py-1 text-[13px]" aria-label="Stage">
                {project.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Prop>
            <Prop label="Type">
              <Select value={task.type} disabled={!canEdit} onChange={(e) => void save({ type: e.target.value as typeof task.type })} className="h-8 py-1 text-[13px]" aria-label="Type">
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPE_META[t].label}
                  </option>
                ))}
              </Select>
            </Prop>
            <Prop label="Priority">
              <Select value={task.priority} disabled={!canEdit} onChange={(e) => void save({ priority: e.target.value as typeof task.priority })} className="h-8 py-1 text-[13px]" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </Select>
            </Prop>
            <Prop label="Story points">
              <Select
                value={task.storyPoints ?? ''}
                disabled={!canEdit}
                onChange={(e) => void save({ storyPoints: e.target.value === '' ? null : Number(e.target.value) })}
                className="h-8 py-1 text-[13px]"
                aria-label="Story points"
              >
                <option value="">Not estimated</option>
                {STORY_POINTS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Prop>
            <Prop label="Agent role">
              <Select
                value={task.assignedRoleId ?? ''}
                disabled={!canEdit}
                onChange={(e) => void save({ assignedRoleId: e.target.value || null })}
                className="h-8 py-1 text-[13px]"
                aria-label="Agent role"
              >
                <option value="">Default for the stage</option>
                {roles
                  .filter((r) => r.enabled && r.assignable)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Prop>
            <Prop label="Human owner">
              <Select
                value={task.assigneeUserId ?? ''}
                disabled={!canEdit}
                onChange={(e) => void save({ assigneeUserId: e.target.value || null })}
                className="h-8 py-1 text-[13px]"
                aria-label="Human owner"
              >
                <option value="">None (an agent may work on it)</option>
                {members.map((mm) => (
                  <option key={mm.userId} value={mm.userId}>
                    {mm.name}
                  </option>
                ))}
              </Select>
            </Prop>
            <Prop label="Sprint">
              <Select value={task.sprintId ?? ''} disabled={!canEdit} onChange={(e) => void save({ sprintId: e.target.value || null })} className="h-8 py-1 text-[13px]" aria-label="Sprint">
                <option value="">No sprint</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.status === 'active' ? ' (active)' : ''}
                  </option>
                ))}
              </Select>
            </Prop>
            {task.type !== 'epic' && (
              <Prop label="Epic">
                <Select value={task.parentId ?? ''} disabled={!canEdit} onChange={(e) => void save({ parentId: e.target.value || null })} className="h-8 py-1 text-[13px]" aria-label="Epic">
                  <option value="">None</option>
                  {epics.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.key} {ep.title}
                    </option>
                  ))}
                </Select>
              </Prop>
            )}
            <Prop label="Labels">
              <Input
                value={labels}
                disabled={!canEdit}
                placeholder="ui, api"
                onChange={(e) => setLabels(e.target.value)}
                onBlur={() => {
                  const next = labels.split(',').map((l) => l.trim()).filter(Boolean);
                  if (next.join() !== task.labels.join()) void save({ labels: next });
                }}
                className="h-8 py-1 text-[13px]"
                aria-label="Labels"
              />
            </Prop>
          </div>

          <div className="rounded-xl border border-line p-3">
            <Switch checked={task.refined} disabled={!canEdit} onChange={(v) => void save({ refined: v })} label="Ready (refined)" description="Meets the Definition of Ready and can be planned into a sprint." />
          </div>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-subtle uppercase">
              <Link2 className="size-3.5" /> Depends on
            </h3>
            <ul className="space-y-1">
              {deps.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 text-[13px]">
                  {d.columnId === lookups.doneColumnId ? <CircleCheck className="size-3.5 text-success" /> : <Lock className="size-3.5 text-warning" />}
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => onOpenTask(d.id)}>
                    <span className="font-mono text-xs text-subtle">{d.key}</span> {d.title}
                  </button>
                  {canEdit && (
                    <IconButton icon={X} size="sm" label={`Remove dependency ${d.key}`} onClick={() => void save({ dependsOn: task.dependsOn.filter((x) => x !== d.id) })} />
                  )}
                </li>
              ))}
              {deps.length === 0 && <li className="text-xs text-subtle">No dependencies.</li>}
            </ul>
            {canEdit && depCandidates.length > 0 && (
              <div className="mt-2 flex gap-2">
                <Select value={depToAdd} onChange={(e) => setDepToAdd(e.target.value)} className="h-8 py-1 text-[13px]" aria-label="Add dependency">
                  <option value="">Add dependency…</option>
                  {depCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.key} {c.title}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  disabled={!depToAdd}
                  onClick={() => void save({ dependsOn: [...task.dependsOn, depToAdd] }).then(() => setDepToAdd(''))}
                >
                  Add
                </Button>
              </div>
            )}
          </section>

          <dl className={clsx('space-y-1 border-t border-line pt-4 text-xs text-muted')}>
            <div className="flex justify-between">
              <dt>Created</dt>
              <dd title={formatDateTime(task.createdAt)}>
                {timeAgo(task.createdAt)} {task.createdByAgent && '· by an agent'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Updated</dt>
              <dd>{timeAgo(task.updatedAt)}</dd>
            </div>
            {task.completedAt && (
              <div className="flex justify-between">
                <dt>Completed</dt>
                <dd>{formatDateTime(task.completedAt)}</dd>
              </div>
            )}
            {task.bounceCount > 0 && (
              <div className="flex justify-between">
                <dt>Rework cycles</dt>
                <dd className="text-danger">{task.bounceCount}</dd>
              </div>
            )}
            {task.claim && (
              <div className="flex justify-between">
                <dt>Claim expires</dt>
                <dd>{timeAgo(task.claim.expiresAt)}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>
    </>
  );
}
