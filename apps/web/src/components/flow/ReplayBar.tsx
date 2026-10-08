import { FastForward, Info, Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { IconButton } from '../ui/Button';
import type { FlowState } from '../../hooks/useFlowState';
import { REPLAY_SPEEDS, type ReplaySpeed } from '../../hooks/useTimeReplay';
import { formatClock, formatDateTime, formatSpan } from '../../lib/format';

const SPEED_LABELS: Record<ReplaySpeed, string> = {
  1: '1× · real time',
  10: '10×',
  60: '60× · 1 min/s',
  300: '300× · 5 min/s',
  1800: '1800× · 30 min/s',
};

/**
 * Play a replay on a real clock (shared by the Flow and Office tabs): pick what to replay (the
 * whole project, the kickoff or a sprint), play, jump between moments, scrub, change the speed
 * and skip quiet stretches.
 */
export function ReplayBar({ state, onExit, onSegment }: { state: FlowState; onExit: () => void; onSegment?: (segmentId: string) => void }) {
  const r = state.replay;
  const elapsed = r.t - r.start;
  const total = r.end - r.start;
  const empty = total <= 0 && r.journey.length === 0;
  // The slider moves in whole seconds from the start; its last step reaches past the exact end.
  const sliderMax = r.start + Math.ceil(Math.max(0, total) / 1000) * 1000;
  return (
    <div className="space-y-2 border-t border-line bg-surface-2/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {onSegment && r.segments.length > 0 && (
          <select
            value={r.segment?.id ?? 'all'}
            onChange={(e) => onSegment(e.target.value)}
            aria-label="What to replay"
            className="field-input h-8 w-auto max-w-60 py-0 text-xs font-medium"
          >
            {r.segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.id !== 'all' && s.to === null ? ' (ongoing)' : ''}
              </option>
            ))}
          </select>
        )}
        {r.segment?.detail && <span className="min-w-0 truncate text-xs text-muted italic">“{r.segment.detail}”</span>}
        <span className="ml-auto text-xs text-muted tabular-nums">
          {r.at ? (
            <>
              <time dateTime={r.at} className="font-medium text-fg">
                {formatClock(r.at)}
              </time>{' '}
              · {formatSpan(elapsed)} / {formatSpan(total)}
            </>
          ) : (
            'Loading the history…'
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={SkipBack} size="sm" label="Previous moment" onClick={() => r.step(-1)} disabled={r.t <= r.start} />
        <button
          type="button"
          onClick={r.toggle}
          disabled={empty}
          aria-label={r.playing ? 'Pause replay' : 'Play replay'}
          className="brand-gradient flex size-9 items-center justify-center rounded-full text-white shadow-card transition hover:scale-105 disabled:opacity-50"
        >
          {r.playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
        </button>
        <IconButton icon={SkipForward} size="sm" label="Next moment" onClick={() => r.step(1)} disabled={r.t >= r.end} />
        <input
          type="range"
          min={r.start}
          max={sliderMax}
          step={1000}
          value={r.t}
          // Whole seconds from the start; the last one snaps to the exact end (which may fall between seconds).
          onChange={(e) => {
            const value = Number(e.target.value);
            r.seek(value + 1000 > r.end ? r.end : value);
          }}
          aria-label="Replay position"
          aria-valuetext={r.at ? formatDateTime(r.at) : undefined}
          className="flow-range mx-1 min-w-32 flex-1"
        />
        <select
          value={r.speed}
          onChange={(e) => r.setSpeed(Number(e.target.value) as ReplaySpeed)}
          aria-label="Replay speed"
          className="field-input h-8 w-auto py-0 text-xs"
        >
          {REPLAY_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {SPEED_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={r.skipQuiet} onChange={(e) => r.setSkipQuiet(e.target.checked)} className="accent-[var(--accent)]" />
          Skip quiet times
        </label>
        <button type="button" onClick={onExit} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-surface-3 hover:text-fg">
          <Radio className="size-3.5" /> Back to live
        </button>
      </div>

      {(r.skipped !== null || !r.exact || r.truncated || empty) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle" role="status">
          {r.skipped !== null && (
            <span className="flex items-center gap-1 font-medium text-accent">
              <FastForward className="size-3" /> Skipped {formatSpan(r.skipped, true)} of quiet
            </span>
          )}
          {empty && <span>Nothing happened in this part of the history yet.</span>}
          {!empty && !r.exact && (
            <span className="flex items-center gap-1">
              <Info className="size-3" />
              {r.presenceSince
                ? `Agents here are inferred from their actions: exact positions are recorded from ${formatDateTime(r.presenceSince)} on.`
                : 'Agents here are inferred from their actions: this history was recorded before exact positions were.'}
            </span>
          )}
          {r.truncated && <span>This history is very long: the oldest details are left out.</span>}
        </p>
      )}
    </div>
  );
}
