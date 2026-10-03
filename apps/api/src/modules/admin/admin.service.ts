import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { AdminStatsDTO, SystemInfoDTO } from '@loop/shared';
import { env } from '../../config/env';
import { versionInfo } from '../../config/version';
import { db, sqlite } from '../../db/client';
import { apiTokens, auditLogs, boardColumns, projects, sessions, tasks, users, workspaces } from '../../db/schema';
import { addHours, now } from '../../lib/time';
import { workspacesConfigured } from '../files/files.service';
import { countOnlineAgents } from '../presence/presence.service';

const startedAt = Date.now();

const n = (row: { n: number } | undefined) => Number(row?.n ?? 0);

export function getAdminStats(): AdminStatsDTO {
  const t = now();
  const dayAgo = addHours(t, -24);
  return {
    users: n(db.select({ n: count() }).from(users).get()),
    activeUsers: n(db.select({ n: count() }).from(users).where(eq(users.status, 'active')).get()),
    admins: n(db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()),
    workspaces: n(db.select({ n: count() }).from(workspaces).get()),
    projects: n(db.select({ n: count() }).from(projects).get()),
    tasks: n(db.select({ n: count() }).from(tasks).where(ne(tasks.type, 'epic')).get()),
    tasksDone: n(
      db
        .select({ n: count() })
        .from(tasks)
        .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
        .where(and(eq(boardColumns.kind, 'done'), ne(tasks.type, 'epic')))
        .get(),
    ),
    activeTokens: n(
      db
        .select({ n: count() })
        .from(apiTokens)
        .where(and(isNull(apiTokens.revokedAt), gt(apiTokens.expiresAt, t)))
        .get(),
    ),
    onlineAgents: countOnlineAgents(),
    sessions24h: n(db.select({ n: count() }).from(sessions).where(gt(sessions.lastSeenAt, dayAgo)).get()),
    failedLogins24h: n(
      db
        .select({ n: count() })
        .from(auditLogs)
        .where(and(sql`${auditLogs.action} in ('auth.login_failed', 'auth.account_locked')`, gt(auditLogs.createdAt, dayAgo)))
        .get(),
    ),
  };
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

export function getSystemInfo(): SystemInfoDTO {
  const dbPath = env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(env.DATABASE_PATH);
  const migrations = sqlite
    .prepare("select count(*) as n from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get() as { n: number };
  const schemaVersion =
    migrations.n > 0 ? (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n : 0;
  return {
    version: versionInfo,
    node: process.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    database: {
      path: dbPath,
      sizeBytes: dbPath === ':memory:' ? 0 : fileSize(dbPath) + fileSize(`${dbPath}-wal`),
      schemaVersion,
    },
    workspacesConfigured: workspacesConfigured(),
  };
}

/** Consistent online backup of the SQLite database to a temporary file (caller deletes it). */
export async function createBackup(): Promise<{ path: string; filename: string; cleanup: () => void }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `loopcoder-backup-${stamp}.db`;
  const path = join(tmpdir(), `${randomUUID()}.db`);
  await sqlite.backup(path);
  return { path, filename, cleanup: () => rmSync(path, { force: true }) };
}
