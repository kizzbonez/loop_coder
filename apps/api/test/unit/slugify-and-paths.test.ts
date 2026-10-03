import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeResolve } from '../../src/modules/files/files.service';
import { slugify } from '../../src/modules/workspaces/workspaces.service';

describe('slugify', () => {
  it.each([
    ['Acme Labs', 'acme-labs'],
    ['  Héllo, Wörld!  ', 'hello-world'],
    ['___', 'workspace'],
    ['a'.repeat(60), 'a'.repeat(40)],
    ['Multi   space--dash', 'multi-space-dash'],
  ])('%j → %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('safeResolve (file browser path guard)', () => {
  const root = mkdtempSync(join(tmpdir(), 'lc-files-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export {}');
  const outside = mkdtempSync(join(tmpdir(), 'lc-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'nope');

  it('resolves paths inside the project folder', () => {
    expect(safeResolve(root, 'src/index.ts')).toBe(join(root, 'src', 'index.ts'));
    expect(safeResolve(root, '')).toBe(root);
    expect(safeResolve(root, '/src')).toBe(join(root, 'src'));
  });

  it.each(['../', '../../etc/passwd', 'src/../../x', '..\\..\\windows'])('rejects traversal %j', (p) => {
    expect(() => safeResolve(root, p)).toThrowError(expect.objectContaining({ status: expect.any(Number) }));
  });

  it('rejects NUL bytes', () => {
    expect(() => safeResolve(root, 'src\0/index.ts')).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('reports missing files as not found', () => {
    expect(() => safeResolve(root, 'nope.txt')).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it('rejects symlinks that escape the project folder', () => {
    try {
      symlinkSync(outside, join(root, 'escape'), 'junction');
    } catch {
      return; // symlinks not permitted on this machine; nothing to test
    }
    expect(() => safeResolve(root, 'escape/secret.txt')).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
