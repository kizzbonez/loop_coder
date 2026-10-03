import { lstatSync, openSync, readdirSync, readSync, closeSync, realpathSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FileEntryDTO } from '@loop/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { workspaces } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { badRequest, HttpError, notFound } from '../../lib/errors';
import { requireProjectAccess } from '../projects/access';
import { getProjectRow } from '../projects/projects.query';

const MAX_ENTRIES = 1000;
const MAX_FILE_BYTES = 512 * 1024;
const HIDDEN = new Set(['.git']);

export interface FileContentDTO {
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
}

export function workspacesConfigured(): boolean {
  return Boolean(env.WORKSPACES_DIR && existsSync(env.WORKSPACES_DIR));
}

function projectRoot(actor: Actor, projectId: string): string {
  requireProjectAccess(actor, projectId, 'viewer');
  if (!env.WORKSPACES_DIR) throw new HttpError(501, 'not_configured', 'The file browser is not configured (WORKSPACES_DIR)');
  const project = getProjectRow(projectId);
  const ws = db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, project.workspaceId)).get();
  if (!ws) throw notFound('Workspace');
  return resolve(env.WORKSPACES_DIR, ws.slug, project.key.toLowerCase());
}

/**
 * Resolve a user-supplied relative path inside `root`, rejecting traversal (`..`), absolute
 * paths and symlinks that point outside the project folder.
 */
export function safeResolve(root: string, relPath: string): string {
  const cleaned = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.includes('\0') || isAbsolute(cleaned)) throw badRequest('Invalid path');
  const target = resolve(root, cleaned);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw badRequest('Invalid path');
  if (!existsSync(target)) throw notFound('Path');
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) throw badRequest('Invalid path');
  return target;
}

export function listDirectory(actor: Actor, projectId: string, relPath: string): FileEntryDTO[] {
  const root = projectRoot(actor, projectId);
  if (!existsSync(root)) return [];
  const dir = safeResolve(root, relPath);
  if (!lstatSync(dir).isDirectory()) throw badRequest('Not a directory');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => !HIDDEN.has(d.name) && (d.isDirectory() || d.isFile()))
    .slice(0, MAX_ENTRIES)
    .map((d) => ({
      name: d.name,
      type: d.isDirectory() ? ('dir' as const) : ('file' as const),
      size: d.isFile() ? lstatSync(join(dir, d.name)).size : 0,
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

export function readFileContent(actor: Actor, projectId: string, relPath: string): FileContentDTO {
  const root = projectRoot(actor, projectId);
  const file = safeResolve(root, relPath);
  const stat = lstatSync(file);
  if (!stat.isFile()) throw badRequest('Not a file');
  const length = Math.min(stat.size, MAX_FILE_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  const binary = buffer.subarray(0, 8000).includes(0);
  return {
    path: relative(root, file).split(sep).join('/'),
    size: stat.size,
    binary,
    truncated: stat.size > MAX_FILE_BYTES,
    content: binary ? null : buffer.toString('utf8'),
  };
}
