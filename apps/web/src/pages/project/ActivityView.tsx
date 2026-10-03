import clsx from 'clsx';
import { Activity, Bot, Cog } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ActivityDTO } from '@loop/shared';
import { Chip } from '../../components/ui/Badge';
import { Avatar, EmptyState, PageLoader } from '../../components/ui/misc';
import { formatDateTime, timeAgo } from '../../lib/format';
import { useActivity } from '../../lib/queries';
import { useBoardLookups, useProjectContext, useTaskDrawer } from './context';

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export function ActivityFeed({ items, compact = false }: { items: ActivityDTO[]; compact?: boolean }) {
  const { project, tasks, roles } = useProjectContext();
  const lookups = useBoardLookups(project, tasks, roles);
  const { openTask } = useTaskDrawer();

  const groups = useMemo(() => {
    const map = new Map<string, ActivityDTO[]>();
    for (const a of items) {
      const day = dayFmt.format(new Date(a.createdAt));
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(a);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div className="space-y-6">
      {groups.map(([day, entries]) => (
        <section key={day}>
          {!compact && <h3 className="mb-3 text-xs font-semibold tracking-wider text-subtle uppercase">{day}</h3>}
          <ol className="relative space-y-3 border-l border-line pl-5">
            {entries.map((a) => {
              const role = a.roleKey ? lookups.rolesByKey.get(a.roleKey) : undefined;
              return (
                <li key={a.id} className="relative">
                  <span className="absolute top-0.5 -left-[31px]">
                    {a.actorType === 'agent' ? (
                      <span className={clsx('brand-gradient flex size-5 items-center justify-center rounded-full text-white', a.action === 'agent.progress' && 'opacity-70')}>
                        <Bot className="size-3" />
                      </span>
                    ) : a.actorType === 'system' ? (
                      <span className="flex size-5 items-center justify-center rounded-full bg-surface-3 text-muted">
                        <Cog className="size-3" />
                      </span>
                    ) : (
                      <Avatar name={a.actorName} size="sm" className="size-5 text-[9px]" />
                    )}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    {role && <Chip color={role.color}>{role.name}</Chip>}
                    {a.taskId && a.taskKey ? (
                      <button type="button" onClick={() => openTask(a.taskId!)} className="font-mono text-xs text-accent hover:underline">
                        {a.taskKey}
                      </button>
                    ) : a.taskKey ? (
                      <span className="font-mono text-xs text-subtle line-through">{a.taskKey}</span>
                    ) : null}
                    <span className={clsx(a.action === 'agent.progress' ? 'text-muted italic' : 'text-fg')}>{a.message}</span>
                    <span className="ml-auto text-xs text-subtle" title={formatDateTime(a.createdAt)}>
                      {timeAgo(a.createdAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function ActivityView() {
  const { project } = useProjectContext();
  const activity = useActivity(project.id, 200);
  const [who, setWho] = useState<'all' | 'agent' | 'human'>('all');
  if (activity.isPending) return <PageLoader />;
  const items = (activity.data ?? []).filter((a) => who === 'all' || (who === 'agent' ? a.actorType === 'agent' : a.actorType === 'user'));

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <h2 className="text-base font-semibold">Activity</h2>
        <div className="ml-auto flex rounded-lg bg-surface-2 p-0.5 text-[13px]" role="radiogroup" aria-label="Filter activity">
          {(['all', 'agent', 'human'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={who === v}
              onClick={() => setWho(v)}
              className={clsx('rounded-md px-3 py-1 capitalize transition', who === v ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}
            >
              {v === 'agent' ? 'Agents' : v === 'human' ? 'Humans' : 'All'}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Activity} title="No activity yet" description="Everything the agent and your team do on this project appears here in real time." />
      ) : (
        <ActivityFeed items={items} />
      )}
    </div>
  );
}
