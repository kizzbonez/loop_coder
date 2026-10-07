import { Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import type { FlowState } from '../../../hooks/useFlowState';
import { REPLAY_SPEEDS } from '../../../hooks/useReplay';
import { formatDateTime } from '../../../lib/format';

/** Play, step, scrub and change speed of a replay (shared by the Flow and Office tabs). */
export function ReplayBar({ state, onExit }: { state: FlowState; onExit: () => void }) {
  const r = state.replay;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/60 px-3 py-2.5">
      <IconButton icon={SkipBack} size="sm" label="Step back" onClick={() => r.step(-1)} disabled={r.cursor === 0} />
      <button
        type="button"
        onClick={r.toggle}
        aria-label={r.playing ? 'Pause replay' : 'Play replay'}
        className="brand-gradient flex size-9 items-center justify-center rounded-full text-white shadow-card transition hover:scale-105"
      >
        {r.playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
      </button>
      <IconButton icon={SkipForward} size="sm" label="Step forward" onClick={() => r.step(1)} disabled={r.cursor >= r.length} />
      <input
        type="range"
        min={0}
        max={r.length}
        value={r.cursor}
        onChange={(e) => r.seek(Number(e.target.value))}
        aria-label="Replay position"
        className="flow-range mx-1 min-w-32 flex-1"
      />
      <span className="w-40 text-right text-xs text-muted tabular-nums">
        {r.length === 0 ? 'No history yet' : `${r.cursor}/${r.length} · ${r.at ? formatDateTime(r.at) : 'start'}`}
      </span>
      <select
        value={r.speed}
        onChange={(e) => r.setSpeed(Number(e.target.value) as (typeof REPLAY_SPEEDS)[number])}
        aria-label="Replay speed"
        className="field-input h-8 w-20 py-0 text-xs"
      >
        {REPLAY_SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <button type="button" onClick={onExit} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-surface-3 hover:text-fg">
        <Radio className="size-3.5" /> Back to live
      </button>
    </div>
  );
}
