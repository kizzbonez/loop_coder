import { describe, expect, it } from 'vitest';
import type { TaskDTO } from '@loop/shared';
import { findContainer, groupByColumn, matchesFilter, positionBetween, serverIndex } from './board';

const task = (over: Partial<TaskDTO>): TaskDTO => ({
  id: 't',
  projectId: 'p',
  key: 'SHOP-1',
  number: 1,
  type: 'story',
  title: 'Title',
  description: '',
  acceptanceCriteria: '',
  priority: 'medium',
  storyPoints: null,
  columnId: 'c1',
  position: 1,
  parentId: null,
  sprintId: null,
  assignedRoleId: null,
  assigneeUserId: null,
  labels: [],
  refined: false,
  bounceCount: 0,
  dependsOn: [],
  claim: null,
  createdByAgent: false,
  remarkCount: 0,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('groupByColumn', () => {
  it('groups by column ordered by position and keeps empty columns', () => {
    const groups = groupByColumn(
      [task({ id: 'b', position: 2 }), task({ id: 'a', position: 1 }), task({ id: 'c', columnId: 'c2' })],
      ['c1', 'c2', 'c3'],
    );
    expect(groups).toEqual({ c1: ['a', 'b'], c2: ['c'], c3: [] });
  });
});

describe('findContainer', () => {
  const items = { c1: ['a', 'b'], c2: [] };
  it('finds the column of an item or recognises a column id', () => {
    expect(findContainer(items, 'b')).toBe('c1');
    expect(findContainer(items, 'c2')).toBe('c2');
    expect(findContainer(items, 'zzz')).toBeUndefined();
  });
});

describe('serverIndex', () => {
  it('maps a drop in an unfiltered column directly', () => {
    expect(serverIndex(['a', 'x', 'b'], 'x', ['a', 'b', 'x'])).toBe(1);
  });
  it('places the item before its next visible neighbour in the full column', () => {
    // Full column: a h1 b h2 c (h* hidden by a filter). Visible after drop: a x c.
    expect(serverIndex(['a', 'x', 'c'], 'x', ['a', 'h1', 'b', 'h2', 'c'])).toBe(4);
  });
  it('appends when dropped last', () => {
    expect(serverIndex(['a', 'b', 'x'], 'x', ['a', 'h', 'b'])).toBe(3);
  });
});

describe('positionBetween', () => {
  it('computes fractional positions like the server', () => {
    expect(positionBetween(undefined, undefined)).toBe(1024);
    expect(positionBetween(undefined, 1024)).toBe(0);
    expect(positionBetween(1024, undefined)).toBe(2048);
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
});

describe('matchesFilter', () => {
  const f = { query: '', type: '', sprintOnly: false, activeSprintId: 's1' };
  it('filters by text in title, key and labels (case-insensitive)', () => {
    const t = task({ title: 'Login page', key: 'SHOP-7', labels: ['auth'] });
    expect(matchesFilter(t, { ...f, query: 'LOGIN' })).toBe(true);
    expect(matchesFilter(t, { ...f, query: 'shop-7' })).toBe(true);
    expect(matchesFilter(t, { ...f, query: 'auth' })).toBe(true);
    expect(matchesFilter(t, { ...f, query: 'billing' })).toBe(false);
  });
  it('filters by type and sprint', () => {
    expect(matchesFilter(task({ type: 'bug' }), { ...f, type: 'story' })).toBe(false);
    expect(matchesFilter(task({ sprintId: null }), { ...f, sprintOnly: true })).toBe(false);
    expect(matchesFilter(task({ sprintId: 's1' }), { ...f, sprintOnly: true })).toBe(true);
  });
});
