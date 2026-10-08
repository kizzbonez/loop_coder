import { useCallback, useEffect, useRef, useState } from 'react';
import { countUpTo } from '../lib/flow/timeline';

/** How many times faster than real time the replay runs. */
export const REPLAY_SPEEDS = [1, 10, 60, 300, 1800] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
export const DEFAULT_SPEED: ReplaySpeed = 60;

/** With "skip quiet times", stretches without anything happening longer than this are jumped over. */
export const QUIET_GAP_MS = 2 * 60_000;
/** A skip lands this long before the next thing that happens, so it is not missed. */
export const SKIP_LEAD_MS = 5_000;
const TICK_MS = 100;
/** How long the "skipped …" note stays up (real time). */
const SKIP_NOTE_MS = 2500;

export interface TimeReplay {
  start: number;
  end: number;
  /** The moment shown (epoch ms). */
  t: number;
  /** The moment shown before the last change (what happened in between can be animated). */
  prev: number;
  playing: boolean;
  speed: ReplaySpeed;
  skipQuiet: boolean;
  /** True when the last change was the clock running (worth animating), false after a seek. */
  advanced: boolean;
  /** Counts every tick, so moments replayed after rewinding animate again. */
  serial: number;
  /** Real time jumped over by the last skip, shown for a moment; null otherwise. */
  skipped: number | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  /** Jump to the next (1) or previous (-1) moment something happened. */
  step: (direction: 1 | -1) => void;
  setSpeed: (speed: ReplaySpeed) => void;
  setSkipQuiet: (on: boolean) => void;
}

interface State {
  tape: string;
  t: number;
  prev: number;
  playing: boolean;
  advanced: boolean;
  serial: number;
  skipped: { ms: number; until: number } | null;
}

/**
 * A clock over a stretch of real time, [start, end]: while playing it runs `speed` times faster
 * than real time, optionally jumping over quiet stretches; `marks` are the moments something
 * happened. A new `tape` (another segment, another work item) rewinds to the start.
 */
export function useTimeReplay(start: number, end: number, marks: number[], tape: string): TimeReplay {
  const [speed, setSpeed] = useState<ReplaySpeed>(DEFAULT_SPEED);
  const [skipQuiet, setSkipQuiet] = useState(true);
  const [state, setState] = useState<State>({ tape, t: start, prev: start, playing: false, advanced: false, serial: 0, skipped: null });
  if (state.tape !== tape) setState({ tape, t: start, prev: start, playing: false, advanced: false, serial: state.serial, skipped: null });

  const clamp = useCallback((t: number) => Math.max(start, Math.min(end, t)), [start, end]);
  const settings = useRef({ speed, skipQuiet, marks, end });
  settings.current = { speed, skipQuiet, marks, end };

  useEffect(() => {
    if (!state.playing) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const nowMs = Date.now();
      const elapsed = nowMs - last;
      last = nowMs;
      setState((s) => {
        if (!s.playing) return s;
        const { speed: x, skipQuiet: skip, marks: m, end: e } = settings.current;
        let next = s.t + elapsed * x;
        let skipped = s.skipped && s.skipped.until > nowMs ? s.skipped : null;
        if (skip) {
          const upcoming = m[countUpTo(m, s.t)];
          const target = upcoming === undefined ? e : upcoming - SKIP_LEAD_MS;
          if ((upcoming === undefined ? e - s.t : upcoming - s.t) > QUIET_GAP_MS && next < target) {
            skipped = { ms: target - s.t, until: nowMs + SKIP_NOTE_MS };
            next = target;
          }
        }
        next = Math.min(e, next);
        return { ...s, prev: s.t, t: next, playing: next < e, advanced: true, serial: s.serial + 1, skipped };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [state.playing]);

  // Keep the clock inside the stretch when it changes (e.g. a live segment that grew).
  useEffect(() => {
    if (state.t > end || state.t < start) setState((s) => ({ ...s, t: clamp(s.t), prev: clamp(s.t), advanced: false }));
  }, [start, end, state.t, clamp]);

  const play = useCallback(() => setState((s) => ({ ...s, playing: true, t: s.t >= end ? start : s.t, prev: s.t >= end ? start : s.t, advanced: false })), [start, end]);
  const pause = useCallback(() => setState((s) => ({ ...s, playing: false })), []);
  const seek = useCallback((t: number) => setState((s) => ({ ...s, t: clamp(t), prev: clamp(t), advanced: false, skipped: null })), [clamp]);
  const step = useCallback(
    (direction: 1 | -1) =>
      setState((s) => {
        const i = countUpTo(marks, s.t);
        // Forward: the next mark after now; back: the last mark before now.
        const target = direction === 1 ? (marks[i] ?? end) : (marks[countUpTo(marks, s.t - 1) - 1] ?? start);
        const t = clamp(target);
        return { ...s, playing: false, prev: s.t, t, advanced: direction === 1 && t > s.t, serial: s.serial + (direction === 1 ? 1 : 0), skipped: null };
      }),
    [marks, start, end, clamp],
  );

  const t = state.tape === tape ? clamp(state.t) : start;
  return {
    start,
    end,
    t,
    prev: state.tape === tape ? clamp(state.prev) : start,
    playing: state.playing && state.tape === tape,
    speed,
    skipQuiet,
    advanced: state.advanced && state.tape === tape,
    serial: state.serial,
    skipped: state.skipped?.ms ?? null,
    play,
    pause,
    toggle: () => (state.playing ? pause() : play()),
    seek,
    step,
    setSpeed,
    setSkipQuiet,
  };
}
