import clsx from 'clsx';
import { Bot, Lock, MessageSquare, RotateCcw, User } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import type { AgentRoleDTO, TaskDTO } from '@loop/shared';
import { ITEM_TYPE_META, PRIORITY_META } from '../../lib/meta';
import { Chip } from '../ui/Badge';

export function PriorityIcon({ priority }: { priority: TaskDTO['priority'] }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className="inline-flex h-3 items-end gap-[2px]" title={`${meta.label} priority`} aria-label={`${meta.label} priority`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="w-[3px] rounded-sm" style={{ height: `${i * 25}%`, backgroundColor: i <= meta.bars ? meta.color : 'var(--surface-3)' }} />
      ))}
    </span>
  );
}

export function TypeIcon({ type, className }: { type: TaskDTO['type']; className?: string }) {
  const meta = ITEM_TYPE_META[type];
  const Icon = meta.icon;
  return <Icon className={clsx('size-3.5 shrink-0', className)} style={{ color: meta.color }} aria-label={meta.label} />;
}

export interface TaskCardProps {
  task: TaskDTO;
  role?: AgentRoleDTO;
  blockedBy: TaskDTO[];
  epic?: TaskDTO;
  assigneeName?: string | null;
  onOpen: () => void;
  dragging?: boolean;
  overlay?: boolean;
  /** Drag-and-drop attributes/listeners, merged onto the card so it stays a single focusable control. */
  dragProps?: HTMLAttributes<HTMLDivElement>;
}

export function TaskCard({ task, role, blockedBy, epic, assigneeName, onOpen, dragging, overlay, dragProps }: TaskCardProps) {
  const working = Boolean(task.claim);
  return (
    <div
      {...dragProps}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Enter opens the item; Space is reserved for keyboard drag-and-drop.
        if (e.key === 'Enter') onOpen();
        dragProps?.onKeyDown?.(e);
      }}
      className={clsx(
        'group rounded-xl border border-line bg-surface p-3 text-left shadow-card transition outline-none',
        'hover:border-line-strong focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        working && 'agent-working border-transparent',
        dragging && 'opacity-40',
        overlay && 'rotate-2 cursor-grabbing shadow-pop',
      )}
      aria-label={`${task.key}: ${task.title}`}
    >
      <div className="flex items-center gap-1.5">
        <TypeIcon type={task.type} />
        <span className="font-mono text-[11px] text-subtle">{task.key}</span>
        {!task.refined && task.type !== 'epic' && (
          <span className="rounded bg-warning/12 px-1 text-[10px] font-medium text-warning" title="Not yet refined (Definition of Ready not met)">
            draft
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <PriorityIcon priority={task.priority} />
          {task.storyPoints != null && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-3 px-1.5 text-[10px] font-semibold tabular-nums text-muted" title="Story points">
              {task.storyPoints}
            </span>
          )}
        </span>
      </div>

      <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug font-medium text-fg">{task.title}</p>

      {(epic || task.labels.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {epic && <Chip color="#a855f7">{epic.title}</Chip>}
          {task.labels.slice(0, 3).map((l) => (
            <span key={l} className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
              {l}
            </span>
          ))}
        </div>
      )}

      {working && role && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-accent-soft px-2 py-1 text-[11px] leading-snug font-medium text-accent">
          <Bot className="size-3.5 shrink-0" />
          <span className="min-w-0">
            {task.claim?.agentName ?? 'Agent'} is working as {role.name}
          </span>
          <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2.5 text-[11px] text-subtle">
        {role && !working && (
          <Chip color={role.color} dot className="max-w-[60%]">
            {role.name}
          </Chip>
        )}
        {assigneeName && (
          <span className="inline-flex items-center gap-1 text-muted" title="Assigned to a human">
            <User className="size-3" /> {assigneeName.split(' ')[0]}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2.5">
          {blockedBy.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-warning" title={`Waiting on ${blockedBy.map((b) => b.key).join(', ')}`}>
              <Lock className="size-3" /> {blockedBy.length}
            </span>
          )}
          {task.bounceCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-danger" title={`Sent back for rework ${task.bounceCount}×`}>
              <RotateCcw className="size-3" /> {task.bounceCount}
            </span>
          )}
          {task.remarkCount > 0 && (
            <span className="inline-flex items-center gap-0.5" title={`${task.remarkCount} remarks`}>
              <MessageSquare className="size-3" /> {task.remarkCount}
            </span>
          )}
          {task.createdByAgent && <Bot className="size-3" aria-label="Created by an agent" />}
        </span>
      </div>
    </div>
  );
}
