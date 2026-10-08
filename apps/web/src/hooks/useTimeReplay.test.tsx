import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPEED, QUIET_GAP_MS, SKIP_LEAD_MS, useTimeReplay } from './useTimeReplay';

const MIN = 60_000;
const START = Date.UTC(2026, 0, 1, 10, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

/** Let the replay clock run for `ms` of real time. */
const run = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('useTimeReplay', () => {
  it('runs on a real clock, `speed` times faster than real time, and stops at the end', () => {
    const marks = [START + MIN, START + 2 * MIN];
    const { result } = renderHook(() => useTimeReplay(START, START + 3 * MIN, marks, 'a'));
    expect(result.current).toMatchObject({ t: START, playing: false, speed: DEFAULT_SPEED, skipQuiet: true });
    act(() => result.current.play());
    run(1000); // one second at 60× = one minute
    expect(result.current.t).toBeCloseTo(START + MIN, -3);
    expect(result.current.advanced).toBe(true);
    run(5000);
    expect(result.current.t).toBe(START + 3 * MIN);
    expect(result.current.playing).toBe(false);
    // Play again from the end starts over.
    act(() => result.current.play());
    expect(result.current.t).toBe(START);
  });

  it('runs slower or faster', () => {
    const { result } = renderHook(() => useTimeReplay(START, START + 60 * MIN, [START + 30 * MIN], 'a'));
    act(() => result.current.setSpeed(1));
    act(() => result.current.setSkipQuiet(false));
    act(() => result.current.play());
    run(2000);
    expect(result.current.t).toBeCloseTo(START + 2000, -3); // real time
    act(() => result.current.setSpeed(1800));
    run(500);
    expect(result.current.t).toBeGreaterThan(START + 14 * MIN);
  });

  it('jumps over quiet stretches, landing just before the next moment, and says how much it skipped', () => {
    const marks = [START + 30 * MIN];
    const { result } = renderHook(() => useTimeReplay(START, START + 40 * MIN, marks, 'a'));
    act(() => result.current.play());
    run(100);
    expect(result.current.t).toBe(START + 30 * MIN - SKIP_LEAD_MS);
    expect(result.current.skipped).toBe(30 * MIN - SKIP_LEAD_MS);
    // The lead plays in real (60×) time, then the quiet ten minutes to the end are skipped too.
    run(100);
    expect(result.current.t).toBe(START + 30 * MIN + 1000);
    run(100);
    expect(result.current.t).toBe(START + 40 * MIN);
    expect(result.current.playing).toBe(false);
  });

  it('plays gaps shorter than the quiet threshold', () => {
    const gap = QUIET_GAP_MS - MIN;
    const { result } = renderHook(() => useTimeReplay(START, START + gap + MIN, [START + gap], 'a'));
    act(() => result.current.play());
    run(100);
    expect(result.current.t).toBe(START + 6000);
    expect(result.current.skipped).toBeNull();
  });

  it('plays quiet stretches when skipping is off', () => {
    const { result } = renderHook(() => useTimeReplay(START, START + 40 * MIN, [START + 30 * MIN], 'a'));
    act(() => result.current.setSkipQuiet(false));
    act(() => result.current.play());
    run(100);
    expect(result.current.t).toBeCloseTo(START + 6000, -3);
    expect(result.current.skipped).toBeNull();
  });

  it('steps between moments and seeks inside the stretch', () => {
    const marks = [START + MIN, START + 5 * MIN];
    const { result } = renderHook(() => useTimeReplay(START, START + 10 * MIN, marks, 'a'));
    act(() => result.current.step(1));
    expect(result.current.t).toBe(START + MIN);
    expect(result.current.advanced).toBe(true);
    act(() => result.current.step(1));
    expect(result.current.t).toBe(START + 5 * MIN);
    act(() => result.current.step(1));
    expect(result.current.t).toBe(START + 10 * MIN); // nothing more: the end
    act(() => result.current.step(-1));
    expect(result.current.t).toBe(START + 5 * MIN);
    act(() => result.current.step(-1));
    expect(result.current.t).toBe(START + MIN);
    act(() => result.current.step(-1));
    expect(result.current.t).toBe(START);
    act(() => result.current.seek(START + 99 * MIN));
    expect(result.current.t).toBe(START + 10 * MIN);
    expect(result.current.advanced).toBe(false);
    act(() => result.current.seek(0));
    expect(result.current.t).toBe(START);
  });

  it('rewinds when the tape changes (another segment or work item)', () => {
    const { result, rerender } = renderHook(({ start, tape }) => useTimeReplay(start, start + 10 * MIN, [start + MIN], tape), {
      initialProps: { start: START, tape: 'sprint-1' },
    });
    act(() => result.current.seek(START + 5 * MIN));
    act(() => result.current.play());
    rerender({ start: START + 60 * MIN, tape: 'sprint-2' });
    expect(result.current.t).toBe(START + 60 * MIN);
    expect(result.current.playing).toBe(false);
  });
});
