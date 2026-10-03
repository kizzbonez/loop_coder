import clsx from 'clsx';
import { Bot, CirclePause, Pause, Play, Radio } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { AgentRoleDTO, ProjectDetailDTO } from '@loop/shared';
import type { StreamStatus } from '../../hooks/useProjectStream';
import { errorMessage } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useUpdateProject } from '../../lib/queries';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Badge';

export function LiveIndicator({ status }: { status: StreamStatus }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 text-[11px] font-medium', status === 'live' ? 'text-success' : 'text-warning')}
      title={status === 'live' ? 'Receiving live updates' : 'Reconnecting to live updates…'}
    >
      <Radio className={clsx('size-3.5', status === 'live' && 'animate-pulse')} />
      {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
    </span>
  );
}

/** Who is working right now and what they are doing, plus the pause/resume control. */
export function AgentStatus({
  project,
  rolesByKey,
  canEdit,
  onOpenTask,
}: {
  project: ProjectDetailDTO;
  rolesByKey: Map<string, AgentRoleDTO>;
  canEdit: boolean;
  onOpenTask: (id: string) => void;
}) {
  const update = useUpdateProject(project.id);
  const paused = project.agentState === 'paused';
  const { agent } = project;
  const role = agent.currentRoleKey ? rolesByKey.get(agent.currentRoleKey) : undefined;

  const toggle = () =>
    update.mutate(
      { agentState: paused ? 'active' : 'paused' },
      {
        onSuccess: () => toast.success(paused ? 'Agent resumed' : 'Agent paused. It stops after its current step.'),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <div
        className={clsx(
          'flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-1.5',
          paused ? 'border-warning/40 bg-warning/8' : agent.online ? 'border-success/40 bg-success/8' : 'border-line bg-surface-2',
        )}
      >
        <span className="relative flex size-2.5 shrink-0">
          {agent.online && !paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
          <span className={clsx('relative inline-flex size-2.5 rounded-full', paused ? 'bg-warning' : agent.online ? 'bg-success' : 'bg-subtle')} />
        </span>
        {paused ? (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-warning">
            <CirclePause className="size-4" /> Agent paused
          </span>
        ) : agent.online ? (
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            <Bot className="size-4 shrink-0 text-success" />
            <span className="font-medium">{agent.agentName ?? 'Agent'}</span>
            {role && (
              <Chip color={role.color} dot>
                {role.name}
              </Chip>
            )}
            {agent.currentTaskKey && agent.currentTaskId && (
              <button type="button" onClick={() => onOpenTask(agent.currentTaskId!)} className="font-mono text-xs text-accent hover:underline">
                {agent.currentTaskKey}
              </button>
            )}
            <span className="hidden max-w-80 truncate text-muted md:inline" title={agent.currentActivity ?? undefined}>
              {agent.currentActivity}
            </span>
          </span>
        ) : (
          <span className="text-[13px] text-muted">
            Agent offline{agent.lastSeenAt ? ` · last seen ${timeAgo(agent.lastSeenAt)}` : ''}
            {!agent.lastSeenAt && (
              <>
                {' · '}
                <Link to={`/p/${project.id}/agent`} className="font-medium text-accent hover:underline">
                  connect an agent
                </Link>
              </>
            )}
          </span>
        )}
      </div>
      {canEdit && (
        <Button size="sm" variant={paused ? 'primary' : 'outline'} icon={paused ? Play : Pause} onClick={toggle} loading={update.isPending}>
          {paused ? 'Resume agent' : 'Pause agent'}
        </Button>
      )}
    </div>
  );
}
