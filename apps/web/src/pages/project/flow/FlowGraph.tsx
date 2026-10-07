import clsx from 'clsx';
import { Bot } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActivityDTO, AgentRoleDTO } from '@loop/shared';
import type { FlowState } from '../../../hooks/useFlowState';
import { geometryFor, samplePoints, type FlowLayout, type Point } from '../../../lib/flow/layout';
import { isCeremony, routeFor, STATIC_EDGES, type FlowAgent, type FlowEdge, type FlowStage, type StageId } from '../../../lib/flow/model';
import { EDGE_TONES, edgeTone, STAGE_ICONS } from './stage-meta';

const TOKEN_MS_PER_EDGE = 1100;
const REMEMBER = 500;

/** Add to a set of seen keys, forgetting the oldest so it never grows without bound. */
function remember(seen: Set<string>, key: string): void {
  seen.add(key);
  if (seen.size > REMEMBER) seen.delete(seen.values().next().value!);
}
const POP_MS = 700;

interface Token {
  id: string;
  points: Point[];
  label: string;
  color: string | null;
  kind: FlowEdge['kind'];
  to: StageId;
  duration: number;
}

export interface FlowGraphProps {
  state: FlowState;
  layout: FlowLayout;
  rolesByKey: Map<string, AgentRoleDTO>;
  selectedStage: StageId | null;
  onSelectStage: (id: StageId) => void;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  reducedMotion: boolean;
}

/** Where an event sends a work item, for the travelling token (null: nothing travels). */
function tokenRoute(a: ActivityDTO, phase: FlowState['phase']): { from: StageId; to: StageId } | null {
  if ((a.action === 'task.moved' || a.action === 'task.escalated') && a.fromKind && a.toKind) return { from: a.fromKind, to: a.toKind };
  if (a.action === 'task.created' && a.toKind && phase === 'kickoff') return { from: 'kickoff', to: a.toKind };
  return null;
}

/** Stages that light up for events without a travelling item. */
function pulseTarget(a: ActivityDTO): StageId | null {
  switch (a.action) {
    case 'ceremony.started':
      return a.ceremony;
    case 'task.created':
      return a.toKind;
    case 'task.refined':
    case 'project.kickoff_completed':
      return 'backlog';
    case 'sprint.started':
      return 'todo';
    case 'sprint.completed':
      return 'sprint_review';
    default:
      return null;
  }
}

export function FlowGraph({ state, layout, rolesByKey, selectedStage, onSelectStage, selectedAgentId, onSelectAgent, reducedMotion }: FlowGraphProps) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [hot, setHot] = useState<Map<string, FlowEdge>>(new Map());
  const [popping, setPopping] = useState<Set<StageId>>(new Set());
  const animated = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const pop = useCallback(
    (stage: StageId) => {
      setPopping((s) => new Set(s).add(stage));
      later(POP_MS, () =>
        setPopping((s) => {
          const next = new Set(s);
          next.delete(stage);
          return next;
        }),
      );
    },
    [later],
  );

  // Turn new events into travelling tokens, glowing paths and pulsing stages.
  useEffect(() => {
    let delay = 0;
    for (const a of state.animate) {
      const key = state.animationKey(a);
      if (animated.current.has(key)) continue;
      remember(animated.current, key);
      const route = tokenRoute(a, state.phase);
      if (!route) {
        const target = pulseTarget(a);
        if (target) later(delay, () => pop(target));
        continue;
      }
      const edges = routeFor(route.from, route.to);
      if (edges.length === 0) continue;
      if (reducedMotion) {
        pop(route.to);
        continue;
      }
      const duration = Math.min(2400, TOKEN_MS_PER_EDGE * edges.length);
      const token: Token = {
        id: a.id,
        points: samplePoints(edges.map((e) => geometryFor(e, layout))),
        label: a.taskKey ?? '',
        color: (a.roleKey && rolesByKey.get(a.roleKey)?.color) || null,
        kind: edges.at(-1)!.kind,
        to: route.to,
        duration,
      };
      // Several events at once (e.g. a sprint start) leave one after another.
      later(delay, () => {
        setTokens((list) => [...list, token]);
        setHot((map) => {
          const next = new Map(map);
          for (const e of edges) next.set(e.id, e);
          return next;
        });
        later(duration + 500, () =>
          setHot((map) => {
            const next = new Map(map);
            for (const e of edges) next.delete(e.id);
            return next;
          }),
        );
      });
      delay += 260;
    }
  }, [state, layout, rolesByKey, reducedMotion, later, pop]);

  const finishToken = useCallback(
    (token: Token) => {
      setTokens((list) => list.filter((t) => t.id !== token.id));
      pop(token.to);
    },
    [pop],
  );

  // Edges: the permanent ones plus temporary ones for jumps without a drawn path.
  const edges = useMemo(() => {
    const list = [...STATIC_EDGES];
    for (const e of hot.values()) if (!list.some((s) => s.id === e.id)) list.push(e);
    return list;
  }, [hot]);

  const agentsByStage = useMemo(() => {
    const map = new Map<StageId, FlowAgent[]>();
    for (const a of state.agents) map.set(a.stage, [...(map.get(a.stage) ?? []), a]);
    return map;
  }, [state.agents]);

  const flowing = !reducedMotion && state.phase === 'sprint';

  return (
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          {[...EDGE_TONES, 'hot' as const].map((tone) => (
            <marker key={tone} id={`flow-arrow-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={`flow-arrow-${tone}`} />
            </marker>
          ))}
        </defs>
        {edges.map((e) => {
          const g = geometryFor(e, layout);
          const tone = edgeTone(e.kind);
          const isHot = hot.has(e.id);
          const inJourney = state.replay.journeyEdges.has(e.id);
          const count = state.edgeCounts.get(e.id);
          // Only the long arcs carry words; the legend explains the rest.
          const showLabel = e.label && (e.kind === 'rework' || (e.kind === 'loop' && layout.orientation === 'horizontal'));
          return (
            <g key={e.id} data-edge={e.id}>
              <path
                d={g.d}
                className={clsx(
                  'flow-edge',
                  `flow-edge-${tone}`,
                  flowing && e.kind === 'forward' && 'flow-edge-flowing',
                  inJourney && 'flow-edge-journey',
                  isHot && 'flow-edge-hot',
                  !STATIC_EDGES.includes(e) && 'flow-edge-transient',
                )}
                markerEnd={`url(#flow-arrow-${isHot || inJourney ? 'hot' : tone})`}
              />
              {showLabel && (
                <text x={g.mid.x} y={g.mid.y + (e.kind === 'rework' && layout.orientation === 'horizontal' ? 14 : -6)} textAnchor="middle" className="flow-edge-label">
                  {e.label}
                  {count ? ` · ${count}` : ''}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {[...state.stages.values()].map((stage) => (
        <StageNode
          key={stage.id}
          stage={stage}
          layout={layout}
          count={state.counts.get(stage.id) ?? 0}
          agents={agentsByStage.get(stage.id) ?? []}
          phase={state.phase}
          selected={selectedStage === stage.id}
          popping={popping.has(stage.id)}
          onSelect={onSelectStage}
        />
      ))}

      {state.agents.map((agent) => (
        <AgentMarker
          key={agent.id}
          agent={agent}
          index={(agentsByStage.get(agent.stage) ?? []).indexOf(agent)}
          layout={layout}
          role={agent.roleKey ? rolesByKey.get(agent.roleKey) : undefined}
          selected={selectedAgentId === agent.id}
          onSelect={onSelectAgent}
          live={!state.replaying}
        />
      ))}

      {tokens.map((t) => (
        <FlowToken key={t.id} token={t} onDone={finishToken} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

const StageNode = memo(function StageNode({
  stage,
  layout,
  count,
  agents,
  phase,
  selected,
  popping,
  onSelect,
}: {
  stage: FlowStage;
  layout: FlowLayout;
  count: number;
  agents: FlowAgent[];
  phase: FlowState['phase'];
  selected: boolean;
  popping: boolean;
  onSelect: (id: StageId) => void;
}) {
  const r = layout.rects[stage.id];
  const Icon = STAGE_ICONS[stage.id];
  const busy = agents.some((a) => a.working);
  const style = { left: r.x, top: r.y, width: r.w, height: r.h };
  const compact = layout.orientation === 'vertical';

  if (stage.type === 'ceremony') {
    const running = isCeremony(stage.id) && agents.some((a) => a.working);
    const current = phase === stage.id;
    return (
      <button
        type="button"
        onClick={() => onSelect(stage.id)}
        style={style}
        aria-label={`${stage.label}${running ? ', in progress' : current ? ', up next' : ''}`}
        className={clsx(
          'flow-node absolute flex items-center justify-center gap-2 rounded-full border px-3 text-[13px] font-medium transition',
          running
            ? 'brand-gradient flow-glow border-transparent text-white'
            : current
              ? 'border-dashed border-accent bg-accent-soft text-accent'
              : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
          selected && 'ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--bg)]',
          popping && 'flow-pop',
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{stage.label}</span>
        {current && !running && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">next</span>}
      </button>
    );
  }

  if (stage.type === 'lounge') {
    return (
      <div style={style} className="absolute flex items-end rounded-2xl border border-dashed border-line-strong bg-surface/60 p-3 text-xs text-subtle">
        <span className="flex items-center gap-1.5">
          <Icon className="size-4" /> Lounge · idle agents
        </span>
      </div>
    );
  }

  const human = stage.id === 'blocked';
  const over = stage.wipLimit != null && count > stage.wipLimit;
  return (
    <button
      type="button"
      onClick={() => onSelect(stage.id)}
      style={style}
      aria-label={`${stage.label}: ${count} item${count === 1 ? '' : 's'}${busy ? ', an agent is working here' : ''}`}
      aria-pressed={selected}
      className={clsx(
        'flow-node group absolute flex flex-col rounded-2xl border text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop',
        compact ? 'justify-center px-4 py-2' : 'p-3.5',
        human ? (count > 0 ? 'flow-attention border-warning/50 bg-warning/10' : 'border-warning/30 bg-surface') : 'border-line bg-surface',
        busy && 'agent-working',
        selected && 'ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--bg)]',
        popping && 'flow-pop',
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className={clsx('flex size-7 shrink-0 items-center justify-center rounded-lg', human ? 'bg-warning/15 text-warning' : 'bg-accent-soft text-accent')}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg" title={stage.label}>
          {stage.label}
        </span>
        {compact && <StageCount count={count} over={over} />}
      </span>
      {!compact && (
        <>
          <span className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted">
            {stage.roleFromItems ? (
              <>
                <span className="size-2 shrink-0 rounded-full bg-[conic-gradient(var(--accent),var(--accent-2),var(--warning),var(--accent))]" />
                Each item&apos;s role
              </>
            ) : stage.role ? (
              <>
                <span className="size-2 shrink-0 rounded-full" style={{ background: stage.role.color }} />
                {stage.role.name}
              </>
            ) : human ? (
              'You'
            ) : (
              'No agent role'
            )}
          </span>
          <span className="mt-auto flex items-center gap-2 text-[11px] text-subtle">
            {stage.wipLimit != null ? (
              <>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className={clsx('block h-full rounded-full transition-[width] duration-500', over ? 'bg-danger' : 'brand-gradient')}
                    style={{ width: `${Math.min(100, (count / Math.max(1, stage.wipLimit)) * 100)}%` }}
                  />
                </span>
                <span className="tabular-nums">
                  {count}/{stage.wipLimit} WIP
                </span>
              </>
            ) : human && count > 0 ? (
              <span className="flex-1 font-medium text-warning">waiting for you</span>
            ) : (
              <span className="flex-1 tabular-nums">{stage.points} pts</span>
            )}
            <StageCount count={count} over={over} />
          </span>
        </>
      )}
    </button>
  );
});

function StageCount({ count, over }: { count: number; over: boolean }) {
  // Keyed by the number so each change replays the little "tick" animation.
  return (
    <span key={count} className={clsx('flow-count text-2xl leading-none font-semibold tabular-nums', over ? 'text-danger' : 'text-fg')}>
      {count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const MARKER = 32;

function markerPosition(rect: { x: number; y: number; w: number; h: number }, index: number, lounge: boolean): Point {
  if (lounge) return { x: rect.x + 18 + index * (MARKER + 8), y: rect.y + 14 };
  return { x: rect.x + rect.w - MARKER - 10 - index * (MARKER - 6), y: rect.y - MARKER / 2 };
}

function AgentMarker({
  agent,
  index,
  layout,
  role,
  selected,
  onSelect,
  live,
}: {
  agent: FlowAgent;
  index: number;
  layout: FlowLayout;
  role?: AgentRoleDTO;
  selected: boolean;
  onSelect: (id: string) => void;
  live: boolean;
}) {
  const p = markerPosition(layout.rects[agent.stage], Math.max(0, index), agent.stage === 'lounge');
  // A speech bubble shows what the agent just said it is doing, for a few seconds.
  const [bubble, setBubble] = useState<string | null>(null);
  const lastActivity = useRef(agent.activity);
  useEffect(() => {
    if (!live || !agent.activity || agent.activity === lastActivity.current) return;
    lastActivity.current = agent.activity;
    setBubble(agent.activity);
  }, [agent.activity, live]);
  // Each bubble closes on its own timer, whatever the agent reports next.
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(() => setBubble(null), 5000);
    return () => clearTimeout(timer);
  }, [bubble]);

  const label = `${agent.name}${role ? ` · ${role.name}` : ''}`;
  // Bubbles open towards the side with room, so they never run off the canvas.
  const bubbleSide = p.x > layout.width - 130 ? 'right-0' : p.x < 110 ? 'left-0' : 'left-1/2 -translate-x-1/2';
  return (
    <div className="flow-agent absolute top-0 left-0 z-20" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
      <button
        type="button"
        onClick={() => onSelect(agent.id)}
        aria-label={`${label}${agent.taskKey ? `, on ${agent.taskKey}` : ''}${agent.working ? '' : ', idle'}`}
        className={clsx(
          'group relative flex items-center justify-center rounded-full border-2 border-surface text-white shadow-pop transition',
          agent.working ? 'brand-gradient' : 'bg-subtle',
          selected && 'ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--bg)]',
        )}
        style={{ width: MARKER, height: MARKER }}
      >
        {agent.working && <span className="flow-ping absolute inset-0 rounded-full" aria-hidden />}
        <Bot className="relative size-4" />
        {role && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface" style={{ background: role.color }} aria-hidden />}
        <span
          className={clsx(
            'pointer-events-none absolute top-1/2 right-full mr-2 -translate-y-1/2 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-fg shadow-card transition',
            index === 0 || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
        >
          {label}
          {agent.taskKey && <span className="ml-1 font-mono text-subtle">{agent.taskKey}</span>}
        </span>
      </button>
      {bubble && (
        <div className={clsx('flow-bubble pointer-events-none absolute bottom-full mb-2 w-max max-w-56 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-[11px] leading-snug text-fg shadow-pop', bubbleSide)} role="status">
          {bubble.length > 90 ? `${bubble.slice(0, 87)}…` : bubble}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Travelling work items
// ---------------------------------------------------------------------------

function FlowToken({ token, onDone }: { token: Token; onDone: (t: Token) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function' || token.points.length === 0) {
      onDone(token);
      return;
    }
    const animation = el.animate(
      token.points.map((p, i) => ({
        transform: `translate(${p.x}px, ${p.y}px) scale(${i === 0 || i === token.points.length - 1 ? 0.6 : 1})`,
        opacity: i === token.points.length - 1 ? 0.2 : 1,
      })),
      { duration: token.duration, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
    );
    animation.onfinish = () => onDone(token);
    return () => animation.cancel();
  }, [token, onDone]);

  const tone = edgeTone(token.kind);
  return (
    <div ref={ref} className="pointer-events-none absolute top-0 left-0 z-30" aria-hidden style={{ transform: `translate(${token.points[0]?.x ?? 0}px, ${token.points[0]?.y ?? 0}px)` }}>
      <div
        className={clsx(
          'flow-token -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold whitespace-nowrap text-white',
          tone === 'rework' ? 'bg-danger' : tone === 'human' ? 'bg-warning' : 'brand-gradient',
        )}
        style={token.color && tone === 'base' ? { background: token.color } : undefined}
      >
        {token.label || '•'}
      </div>
    </div>
  );
}

