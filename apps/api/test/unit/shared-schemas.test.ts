import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  createTaskSchema,
  createTokenSchema,
  DEFAULT_SETTINGS,
  emailSchema,
  formatTaskKey,
  loginSchema,
  moveTaskSchema,
  projectKeySchema,
  settingsSchema,
  setupSchema,
  slugSchema,
  storyPointsSchema,
  updateColumnSchema,
} from '@loop/shared';

describe('shared validation schemas', () => {
  it('normalises emails to trimmed lowercase', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it.each(['not-an-email', 'a@', '@b.com', ''])('rejects invalid email %j', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });

  it('upper-cases project keys and validates their shape', () => {
    expect(projectKeySchema.parse('shop')).toBe('SHOP');
    expect(projectKeySchema.safeParse('1ABC').success).toBe(false);
    expect(projectKeySchema.safeParse('A').success).toBe(false);
    expect(projectKeySchema.safeParse('TOOLONGKEY').success).toBe(false);
    expect(projectKeySchema.safeParse('AB-C').success).toBe(false);
  });

  it('validates workspace slugs', () => {
    expect(slugSchema.parse('Acme-Labs')).toBe('acme-labs');
    expect(slugSchema.safeParse('-bad').success).toBe(false);
    expect(slugSchema.safeParse('bad-').success).toBe(false);
    expect(slugSchema.safeParse('no spaces').success).toBe(false);
  });

  it('only accepts Fibonacci story points', () => {
    for (const ok of [0, 1, 2, 3, 5, 8, 13, 21]) expect(storyPointsSchema.safeParse(ok).success).toBe(true);
    for (const bad of [4, 6, 7, 10, -1, 1.5]) expect(storyPointsSchema.safeParse(bad).success).toBe(false);
  });

  it('applies sensible defaults when creating work items', () => {
    const item = createTaskSchema.parse({ title: 'Login page' });
    expect(item).toMatchObject({ type: 'story', priority: 'medium', labels: [], refined: false, dependsOn: [] });
  });

  it('rejects empty titles and oversized label lists', () => {
    expect(createTaskSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x', labels: Array(11).fill('l') }).success).toBe(false);
  });

  it('does not allow a token scoped to both a workspace and a project', () => {
    const r = createTokenSchema.safeParse({
      name: 't',
      expiresInDays: 10,
      workspaceId: '6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e6f',
      projectId: '6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e70',
    });
    expect(r.success).toBe(false);
  });

  it('requires a workspace when creating a project', () => {
    expect(createProjectSchema.safeParse({ name: 'x', key: 'XX' }).success).toBe(false);
  });

  it('validates column colours and WIP limits', () => {
    expect(updateColumnSchema.safeParse({ color: '#12abef' }).success).toBe(true);
    expect(updateColumnSchema.safeParse({ color: 'red' }).success).toBe(false);
    expect(updateColumnSchema.safeParse({ wipLimit: 0 }).success).toBe(false);
  });

  it('bounds move indexes', () => {
    expect(moveTaskSchema.safeParse({ columnId: '6f1c1b0e-3c1a-4c5e-9d2f-1a2b3c4d5e6f', index: -1 }).success).toBe(false);
  });

  it('fills setup wizard defaults', () => {
    const data = setupSchema.parse({ setupCode: 'X', name: 'A', email: 'a@b.co', password: 'p' });
    expect(data).toMatchObject({ appName: 'Loop Coder', workspaceName: 'My Workspace', registrationEnabled: false });
  });

  it('requires a password on login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('ships valid default settings', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('formats work item keys', () => {
    expect(formatTaskKey('SHOP', 12)).toBe('SHOP-12');
  });
});
