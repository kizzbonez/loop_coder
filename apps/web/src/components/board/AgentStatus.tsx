import clsx from 'clsx';
import { Bot, CirclePause, CircleStop, Pause, Play, Radio, Square } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { AgentRoleDTO, AgentState, ProjectDetailDTO } from '@loop/shared';
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

/** What changing the agent state means for the agent, said once it is saved. */
function confirmation(from: AgentState, to: AgentState): string {
  if (to === 'paused') return 'Agent paused. It finishes its current step, then waits until you resume.';
  if (to === 'stopped') return 'Agent stopped. It finishes its current step, then ends its session.';
  return from === 'stopped'
    ? 'Agent can work again. Start it from your coding agent (see the Agent page).'
    : 'Agent resumed. A waiting agent carries on right away.';
}

/** Who is working right now and what they are doing, plus the pause, resume and stop controls. */
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
  const state = project.agentState;
  const paused = state === 'paused';
  const stopped = state === 'stopped';
  const { agent } = project;
  const role = agent.currentRoleKey ? rolesByKey.get(agent.currentRoleKey) : undefined;

  const change = (to: AgentState) =>
    update.mutate(
      { agentState: to },
      {
        onSuccess: () => toast.success(confirmation(state, to)),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  const pending = update.isPending ? update.variables?.agentState : undefined;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <div
        className={clsx(
          'flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-1.5',
          paused ? 'border-warning/40 bg-warning/8' : stopped ? 'border-line bg-surface-2' : agent.online ? 'border-success/40 bg-success/8' : 'border-line bg-surface-2',
        )}
      >
        <span className="relative flex size-2.5 shrink-0">
          {agent.online && state === 'active' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
          <span className={clsx('relative inline-flex size-2.5 rounded-full', paused ? 'bg-warning' : stopped ? 'bg-danger' : agent.online ? 'bg-success' : 'bg-subtle')} />
        </span>
        {paused ? (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-warning">
            <CirclePause className="size-4" /> <span>Agent paused</span>
            <span className="font-normal text-muted">{agent.online ? '· waiting for you to resume' : '· resumes when you say so'}</span>
          </span>
        ) : stopped ? (
          <span className="flex items-center gap-1.5 text-[13px] font-medium">
            <CircleStop className="size-4 text-danger" /> <span>Agent stopped</span>
            <span className="font-normal text-muted">{agent.online ? '· finishing its current step' : '· resume, then start it again'}</span>
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
        <div className="flex items-center gap-2">
          {state === 'active' ? (
            <Button size="sm" variant="outline" icon={Pause} onClick={() => change('paused')} loading={pending === 'paused'} disabled={update.isPending}>
              Pause agent
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={Play} onClick={() => change('active')} loading={pending === 'active'} disabled={update.isPending}>
              Resume agent
            </Button>
          )}
          {!stopped && (
            <Button
              size="sm"
              variant="outline"
              icon={Square}
              onClick={() => change('stopped')}
              loading={pending === 'stopped'}
              disabled={update.isPending}
              title="The agent finishes its current step and ends its session"
            >
              Stop agent
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
