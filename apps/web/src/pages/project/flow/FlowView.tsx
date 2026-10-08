import clsx from 'clsx';
import { ArrowRight, Bot, Clock, Workflow, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ActivityDTO, AgentRoleDTO } from '@loop/shared';
import { Chip } from '../../../components/ui/Badge';
import { IconButton } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/misc';
import { useFlowState, type FlowState } from '../../../hooks/useFlowState';
import { useElementWidth, useReducedMotion } from '../../../hooks/useMeasure';
import { formatDateTime, timeAgo } from '../../../lib/format';
import { layoutFlow } from '../../../lib/flow/layout';
import { SEGMENT_ID } from '../../../lib/flow/timeline';
import { CEREMONY_LABELS } from '@loop/shared';
import { type FlowAgent, type StageId } from '../../../lib/flow/model';
import { useBoardLookups, useProjectContext, useTaskDrawer } from '../context';
import { FlowGraph } from './FlowGraph';
import { ModeToggle } from '../../../components/flow/ModeToggle';
import { ReplayBar } from '../../../components/flow/ReplayBar';
import { STAGE_ICONS } from './stage-meta';

/**
 * `?replay=all` replays the whole project, `?replay=kickoff` or `?replay=sprint-2` one part of it;
 * `?replay=<item id>` follows one work item's journey.
 */
export function FlowView() {
  const ctx = useProjectContext();
  const { project, tasks, roles } = ctx;
  const lookups = useBoardLookups(project, tasks, roles);
  const [params, setParams] = useSearchParams();
  const replayParam = params.get('replay');
  const segment = replayParam && SEGMENT_ID.test(replayParam) ? replayParam : undefined;
  const focusTaskId = replayParam && !segment ? replayParam : null;
  const state = useFlowState(ctx, { replay: Boolean(replayParam), segment, focusTaskId });
  const reducedMotion = useReducedMotion();
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => layoutFlow(width || 1200), [width]);
  const [selectedStage, setSelectedStage] = useState<StageId | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const setReplay = (value: string | null) =>
    setParams((p) => {
      if (value) p.set('replay', value);
      else p.delete('replay');
      return p;
    });

  const focusTask = focusTaskId ? lookups.tasksById.get(focusTaskId) : undefined;
  if (state.loading) return <PageLoader />;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Workflow className="size-4 text-accent" /> Flow
          </h2>
          <p className="text-[13px] text-muted">How work and agents move through the SDLC{state.replaying ? ', replayed from the history' : ', live'}.</p>
        </div>
        {focusTask && (
          <Chip color="var(--accent)" className="ml-1">
            Following <span className="font-mono">{focusTask.key}</span>
          </Chip>
        )}
        <div className="ml-auto">
          <ModeToggle label="Flow mode" replaying={state.replaying} onChange={(replay) => setReplay(replay ? (replayParam ?? 'all') : null)} />
        </div>
      </div>

      {/* The graph needs the full width; the panels move beside it only on very wide screens. */}
      <div className="grid gap-4 min-[1760px]:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card overflow-hidden">
          <div ref={measure} className="flow-canvas overflow-x-auto p-2 sm:p-3">
            {width > 0 && (
              <FlowGraph
                state={state}
                layout={layout}
                rolesByKey={lookups.rolesByKey}
                selectedStage={selectedStage}
                onSelectStage={(id) => {
                  setSelectedAgentId(null);
                  setSelectedStage((s) => (s === id ? null : id));
                }}
                selectedAgentId={selectedAgentId}
                onSelectAgent={(id) => {
                  setSelectedStage(null);
                  setSelectedAgentId((s) => (s === id ? null : id));
                }}
                reducedMotion={reducedMotion}
              />
            )}
          </div>
          {state.replaying && <ReplayBar state={state} onExit={() => setReplay(null)} onSegment={focusTaskId ? undefined : setReplay} />}
          <Legend />
        </section>

        <aside className="grid content-start gap-4 md:grid-cols-2 min-[1760px]:grid-cols-1">
          {selectedStage ? (
            <StagePanel stageId={selectedStage} state={state} rolesByKey={lookups.rolesByKey} onClose={() => setSelectedStage(null)} />
          ) : focusTaskId ? (
            <JourneyPanel state={state} rolesByKey={lookups.rolesByKey} />
          ) : (
            <AgentsPanel state={state} rolesByKey={lookups.rolesByKey} selectedId={selectedAgentId} onSelect={setSelectedAgentId} />
          )}
          <FeedPanel state={state} rolesByKey={lookups.rolesByKey} />
        </aside>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ['flow-legend-base', 'Work moving forward'],
    ['flow-legend-rework', 'Rework'],
    ['flow-legend-human', 'Needs a person'],
    ['flow-legend-ceremony', 'Scrum loop'],
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
      {items.map(([cls, label]) => (
        <span key={cls} className="flex items-center gap-1.5">
          <span className={clsx('h-0.5 w-5 rounded-full', cls)} /> {label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="brand-gradient flex size-4 items-center justify-center rounded-full text-white">
          <Bot className="size-2.5" />
        </span>
        Agent
      </span>
      <span className="ml-auto hidden sm:inline">Click a stage to see its items</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

function Panel({ title, children, actions, className }: { title: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('card overflow-hidden', className)}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

function RoleChip({ roleKey, rolesByKey }: { roleKey: string | null; rolesByKey: Map<string, AgentRoleDTO> }) {
  const role = roleKey ? rolesByKey.get(roleKey) : undefined;
  return role ? <Chip color={role.color}>{role.name}</Chip> : null;
}

function stageName(state: FlowState, id: StageId): string {
  return state.stages.get(id)?.label ?? id;
}

function AgentsPanel({
  state,
  rolesByKey,
  selectedId,
  onSelect,
}: {
  state: FlowState;
  rolesByKey: Map<string, AgentRoleDTO>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { openTask } = useTaskDrawer();
  return (
    <Panel title={state.replaying ? 'Agents at this moment' : `Agents online · ${state.agents.length}`}>
      {state.agents.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">
          {state.replaying ? 'No agent has acted yet at this point.' : 'No agent is connected. Connect one from the Agent tab and it will appear here.'}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {state.agents.map((a: FlowAgent) => (
            <li key={a.id}>
              <div
                className={clsx('flex gap-3 px-4 py-3 transition', selectedId === a.id && 'bg-accent-soft')}
                onMouseEnter={() => onSelect(a.id)}
                onMouseLeave={() => onSelect(null)}
              >
                <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full text-white', a.working ? 'brand-gradient' : 'bg-subtle')}>
                  <Bot className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold">{a.name}</span>
                    <RoleChip roleKey={a.roleKey} rolesByKey={rolesByKey} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {a.working ? 'In' : 'Last in'} <span className="font-medium text-fg">{stageName(state, a.stage)}</span>
                    {a.taskKey && a.taskId ? (
                      <>
                        {' · '}
                        <button type="button" onClick={() => openTask(a.taskId!)} className="font-mono text-accent hover:underline">
                          {a.taskKey}
                        </button>
                      </>
                    ) : a.taskKey ? (
                      <span className="font-mono"> · {a.taskKey}</span>
                    ) : null}
                  </p>
                  {a.activity && <p className="mt-1 line-clamp-2 text-xs text-subtle italic">“{a.activity}”</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function StagePanel({ stageId, state, rolesByKey, onClose }: { stageId: StageId; state: FlowState; rolesByKey: Map<string, AgentRoleDTO>; onClose: () => void }) {
  const { openTask } = useTaskDrawer();
  const stage = state.stages.get(stageId);
  if (!stage) return null;
  const Icon = STAGE_ICONS[stageId];
  const agentsHere = state.agents.filter((a) => a.stage === stageId);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-accent" /> {stage.label}
        </span>
      }
      actions={<IconButton icon={X} size="sm" label="Close stage details" onClick={onClose} />}
    >
      <div className="space-y-3 px-4 py-3 text-[13px]">
        <p className="text-muted">
          {stage.type === 'ceremony'
            ? `${CEREMONY_LABELS[stageId as keyof typeof CEREMONY_LABELS]} is run by the ${stage.role?.name ?? 'Project Manager'}.`
            : stage.roleFromItems
              ? 'Each item is worked by its own assigned role.'
              : stage.role
                ? `Worked by the ${stage.role.name}.`
                : stageId === 'blocked'
                  ? 'Items wait here for your answer.'
                  : 'No agent role works this stage.'}
          {stage.wipLimit != null && ` WIP limit ${stage.wipLimit}.`}
        </p>
        {agentsHere.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Bot className="size-3.5" /> {agentsHere.map((a) => a.name).join(', ')} {agentsHere.length === 1 ? 'is' : 'are'} here
          </p>
        )}
        {state.replaying && stage.type === 'column' && <p className="text-xs text-subtle">The list shows today&apos;s items; the count on the graph is replayed.</p>}
      </div>
      {stage.tasks.length > 0 && (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto border-t border-line">
          {stage.tasks.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => openTask(t.id)} className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition hover:bg-surface-2">
                <span className="mt-px font-mono text-xs text-accent">{t.key}</span>
                <span className="min-w-0 flex-1 text-[13px]">{t.title}</span>
                {t.claim && <RoleChip roleKey={t.claim.roleKey} rolesByKey={rolesByKey} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 6) / 10;
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

function JourneyPanel({ state, rolesByKey }: { state: FlowState; rolesByKey: Map<string, AgentRoleDTO> }) {
  const { openTask } = useTaskDrawer();
  const { journey, reached, seek, focusTaskId } = state.replay;
  const total = journey.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  return (
    <Panel
      title="Journey"
      actions={
        focusTaskId ? (
          <button type="button" onClick={() => openTask(focusTaskId)} className="text-xs font-medium text-accent hover:underline">
            Open item
          </button>
        ) : undefined
      }
    >
      {journey.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">No recorded moves for this item yet.</p>
      ) : (
        <>
          <ol className="relative space-y-0.5 px-4 py-3">
            {journey.map((step, i) => {
              const done = i < reached;
              const a = step.activity;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => seek(Date.parse(a.createdAt))}
                    className={clsx('flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2', i === reached - 1 && 'bg-accent-soft')}
                  >
                    <span className={clsx('mt-1 size-2.5 shrink-0 rounded-full border-2', done ? 'border-accent bg-accent' : 'border-line-strong bg-surface')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
                        {a.fromKind && (
                          <>
                            <span className="text-muted">{stageName(state, a.fromKind)}</span>
                            <ArrowRight className="size-3 text-subtle" />
                          </>
                        )}
                        <span className="font-medium">{a.toKind ? stageName(state, a.toKind) : a.message}</span>
                        <RoleChip roleKey={a.roleKey} rolesByKey={rolesByKey} />
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-subtle">
                        <span>{a.actorName ?? 'System'}</span>
                        <span title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span>
                        {step.durationMs != null && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="size-3" /> {duration(step.durationMs)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {total > 0 && <p className="border-t border-line px-4 py-2 text-xs text-muted">Total time recorded: {duration(total)}</p>}
        </>
      )}
    </Panel>
  );
}

function FeedLine({ a, state, rolesByKey }: { a: ActivityDTO; state: FlowState; rolesByKey: Map<string, AgentRoleDTO> }) {
  const { openTask } = useTaskDrawer();
  const tone =
    a.action === 'task.escalated' || a.toKind === 'blocked'
      ? 'bg-warning'
      : a.fromKind && a.toKind && ['review', 'testing'].includes(a.fromKind) && a.toKind === 'in_progress'
        ? 'bg-danger'
        : a.actorType === 'agent'
          ? 'brand-gradient'
          : 'bg-subtle';
  return (
    <li className="flow-feed-in flex gap-2.5 px-4 py-2">
      <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', tone)} />
      <div className="min-w-0 flex-1 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {a.taskKey &&
            (a.taskId ? (
              <button type="button" onClick={() => openTask(a.taskId!)} className="font-mono font-medium text-accent hover:underline">
                {a.taskKey}
              </button>
            ) : (
              <span className="font-mono">{a.taskKey}</span>
            ))}
          {a.fromKind && a.toKind ? (
            <span className="flex items-center gap-1 text-fg">
              {stageName(state, a.fromKind)} <ArrowRight className="size-3 text-subtle" /> {stageName(state, a.toKind)}
            </span>
          ) : (
            <span className="text-fg">{a.message}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-subtle">
          <span>{a.actorName ?? 'System'}</span>
          <RoleChip roleKey={a.roleKey} rolesByKey={rolesByKey} />
          <span className="ml-auto" title={formatDateTime(a.createdAt)}>
            {timeAgo(a.createdAt)}
          </span>
        </div>
      </div>
    </li>
  );
}

function FeedPanel({ state, rolesByKey }: { state: FlowState; rolesByKey: Map<string, AgentRoleDTO> }) {
  return (
    <Panel
      title={state.replaying ? 'Replayed events' : 'Live feed'}
      actions={!state.replaying && <span className="flow-live-dot size-2 rounded-full bg-success" aria-hidden />}
    >
      {state.feed.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">{state.replaying ? 'Press play to replay the history.' : 'Moves appear here the moment they happen.'}</p>
      ) : (
        <ol className="max-h-[420px] divide-y divide-line overflow-y-auto" role="log" aria-live="polite" aria-label="Flow events">
          {state.feed.map((a) => (
            <FeedLine key={a.id} a={a} state={state} rolesByKey={rolesByKey} />
          ))}
        </ol>
      )}
    </Panel>
  );
}
