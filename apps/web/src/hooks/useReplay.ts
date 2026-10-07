import { useCallback, useEffect, useState } from 'react';

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplayControls {
  /** Number of steps applied, 0…length. */
  cursor: number;
  length: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** True when the last cursor change was a single step forward (worth animating). */
  advanced: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (cursor: number) => void;
  step: (delta: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
}

/**
 * A tape player over `length` steps: one step every `stepMs / speed` while playing. A new
 * `tape` (e.g. switching from the project replay to one item's journey) rewinds to the start.
 */
export function useReplay(length: number, stepMs = 1400, tape: string = ''): ReplayControls {
  const [state, setState] = useState({ cursor: 0, playing: false, speed: 1 as ReplaySpeed, advanced: false, tape });
  if (state.tape !== tape) setState((s) => ({ ...s, tape, cursor: 0, playing: false, advanced: false }));
  const clamp = useCallback((n: number) => Math.max(0, Math.min(length, n)), [length]);

  useEffect(() => {
    if (!state.playing) return;
    if (state.cursor >= length) {
      setState((s) => ({ ...s, playing: false }));
      return;
    }
    const timer = setTimeout(() => setState((s) => ({ ...s, cursor: Math.min(length, s.cursor + 1), advanced: true })), stepMs / state.speed);
    return () => clearTimeout(timer);
  }, [state.playing, state.cursor, state.speed, length, stepMs]);

  // The history can grow while replaying; keep the cursor in range.
  useEffect(() => {
    if (state.cursor > length) setState((s) => ({ ...s, cursor: length, advanced: false }));
  }, [length, state.cursor]);

  const play = useCallback(() => setState((s) => ({ ...s, playing: true, cursor: s.cursor >= length ? 0 : s.cursor, advanced: false })), [length]);
  const pause = useCallback(() => setState((s) => ({ ...s, playing: false })), []);
  return {
    ...state,
    // Never point past the end, even for the one render before the effect above catches up.
    cursor: state.tape === tape ? Math.min(state.cursor, length) : 0,
    length,
    play,
    pause,
    toggle: () => (state.playing ? pause() : play()),
    seek: (cursor) => setState((s) => ({ ...s, cursor: clamp(cursor), advanced: false })),
    step: (delta) => setState((s) => ({ ...s, playing: false, cursor: clamp(s.cursor + delta), advanced: delta === 1 && s.cursor < length })),
    setSpeed: (speed) => setState((s) => ({ ...s, speed })),
  };
}
