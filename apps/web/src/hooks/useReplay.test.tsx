import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../components/layout/ErrorBoundary';
import { useReplay } from './useReplay';

describe('useReplay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('steps, seeks and stays within the tape', () => {
    const { result } = renderHook(() => useReplay(3));
    expect(result.current.cursor).toBe(0);
    act(() => result.current.step(1));
    expect(result.current).toMatchObject({ cursor: 1, advanced: true });
    act(() => result.current.seek(10));
    expect(result.current).toMatchObject({ cursor: 3, advanced: false });
    act(() => result.current.step(1));
    expect(result.current).toMatchObject({ cursor: 3, advanced: false });
    act(() => result.current.step(-5));
    expect(result.current.cursor).toBe(0);
  });

  it('plays one step per interval, faster at higher speed, and stops at the end', () => {
    const { result } = renderHook(() => useReplay(2, 1000));
    act(() => result.current.setSpeed(2));
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.cursor).toBe(1);
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.cursor).toBe(2);
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.playing).toBe(false);
    // Playing again from the end starts over.
    act(() => result.current.play());
    expect(result.current.cursor).toBe(0);
  });

  it('rewinds when the tape changes and never points past a shorter tape', () => {
    const { result, rerender } = renderHook(({ length, tape }) => useReplay(length, 1000, tape), { initialProps: { length: 30, tape: 'all' } });
    act(() => result.current.seek(30));
    rerender({ length: 8, tape: 'item-1' });
    expect(result.current.cursor).toBe(0);
    act(() => result.current.seek(8));
    rerender({ length: 5, tape: 'item-1' }); // the same tape got shorter
    expect(result.current.cursor).toBe(5);
  });
});

describe('ErrorBoundary', () => {
  function Boom({ fail }: { fail: boolean }) {
    if (fail) throw new Error('kaput');
    return <p>fine</p>;
  }

  it('shows a way out instead of a blank page, and recovers on navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom fail />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('This page ran into a problem');
    expect(screen.getByRole('button', { name: /Reload page/ })).toBeTruthy();
    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom fail />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom fail={false} />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByText('fine')).toBeTruthy();
  });
});

describe('useReplay serial', () => {
  it('counts every step forward, also when a step is replayed after rewinding', () => {
    const { result } = renderHook(() => useReplay(3));
    act(() => result.current.step(1));
    expect(result.current.serial).toBe(1);
    act(() => result.current.step(-1));
    act(() => result.current.step(1));
    expect(result.current).toMatchObject({ cursor: 1, serial: 2, advanced: true });
    act(() => result.current.seek(3));
    act(() => result.current.step(1)); // already at the end
    expect(result.current.serial).toBe(2);
  });
});
