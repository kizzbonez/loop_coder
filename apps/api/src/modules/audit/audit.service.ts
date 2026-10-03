import { and, desc, eq, like, lt, type SQL } from 'drizzle-orm';
import type { AuditLogDTO, AuthorType } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import { auditLogs } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { logger } from '../../lib/logger';

export interface AuditEntry {
  action: string;
  actor?: Pick<Actor, 'userId' | 'email' | 'kind' | 'ip' | 'userAgent'> | null;
  actorType?: AuthorType;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only security/audit trail. Never throws: auditing must not break the request. */
export function audit(entry: AuditEntry, exec: Executor = db): void {
  try {
    exec
      .insert(auditLogs)
      .values({
        action: entry.action,
        actorUserId: entry.actor?.userId ?? null,
        actorEmail: entry.actor?.email ?? null,
        actorType: entry.actorType ?? (entry.actor ? (entry.actor.kind === 'agent' ? 'agent' : 'user') : 'system'),
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.ip ?? entry.actor?.ip ?? null,
        userAgent: entry.userAgent ?? entry.actor?.userAgent ?? null,
        metadata: entry.metadata ?? null,
      })
      .run();
  } catch (err) {
    logger.error({ err, action: entry.action }, 'failed to write audit log');
  }
}

export interface AuditQuery {
  action?: string;
  actorUserId?: string;
  before?: Date;
  limit: number;
}

export function listAudit(query: AuditQuery): { items: AuditLogDTO[]; nextCursor: string | null } {
  const where: SQL[] = [];
  if (query.action) where.push(like(auditLogs.action, `${query.action.replace(/[%_]/g, '')}%`));
  if (query.actorUserId) where.push(eq(auditLogs.actorUserId, query.actorUserId));
  if (query.before) where.push(lt(auditLogs.createdAt, query.before));

  const rows = db
    .select()
    .from(auditLogs)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.limit + 1)
    .all();

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      actorEmail: r.actorEmail,
      actorType: r.actorType,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      ip: r.ip,
      metadata: r.metadata ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: rows.length > query.limit && last ? last.createdAt.toISOString() : null,
  };
}
