import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, initials, percent, pluralize, timeAgo } from './format';

describe('format helpers', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');

  it('formats relative times', () => {
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo('2026-10-03T11:59:58Z', now)).toBe('just now');
    expect(timeAgo('2026-10-03T11:55:00Z', now)).toMatch(/5 minutes ago/);
    expect(timeAgo('2026-10-02T12:00:00Z', now)).toMatch(/yesterday|1 day ago/);
  });

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats durations', () => {
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(3_700)).toBe('1h 1m');
    expect(formatDuration(90_000)).toBe('1d 1h');
  });

  it('computes initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('grace')).toBe('G');
    expect(initials('Jean Claude Van Damme')).toBe('JD');
    expect(initials(null)).toBe('?');
  });

  it('computes safe percentages and plurals', () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBe(0);
    expect(pluralize(1, 'item')).toBe('1 item');
    expect(pluralize(2, 'item')).toBe('2 items');
  });
});
