import { and, desc, eq, lte, ne } from 'drizzle-orm';
import type { SessionDTO } from '@loop/shared';
import { db } from '../../db/client';
import { sessions, users, type SessionRow, type UserRow } from '../../db/schema';
import { generateToken, sha256 } from '../../lib/crypto';
import { addHours, now } from '../../lib/time';
import { getSettings } from '../settings/settings.service';

export const SESSION_COOKIE = 'lc_session';
const REFRESH_AFTER_MS = 5 * 60_000;

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

export function createSession(userId: string, meta: SessionMeta): { token: string; session: SessionRow } {
  const token = generateToken('lcs');
  const ttl = getSettings().security.sessionTtlHours;
  const session = db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: addHours(now(), ttl),
    })
    .returning()
    .get();
  return { token, session };
}

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
  /** True when the expiry was extended and the cookie should be re-issued. */
  refreshed: boolean;
}

/** Look up a session by its opaque cookie token; expired or disabled-user sessions are rejected. */
export function resolveSession(token: string | undefined): ResolvedSession | null {
  if (!token || token.length > 200) return null;
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .get();
  if (!row) return null;

  const t = now();
  if (row.session.expiresAt <= t || row.user.status !== 'active') {
    db.delete(sessions).where(eq(sessions.id, row.session.id)).run();
    return null;
  }

  // Sliding expiration, written at most every few minutes.
  if (t.getTime() - row.session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    const expiresAt = addHours(t, getSettings().security.sessionTtlHours);
    db.update(sessions).set({ lastSeenAt: t, expiresAt }).where(eq(sessions.id, row.session.id)).run();
    return { session: { ...row.session, lastSeenAt: t, expiresAt }, user: row.user, refreshed: true };
  }
  return { ...row, refreshed: false };
}

export function revokeSession(sessionId: string, userId?: string): boolean {
  const where = userId
    ? and(eq(sessions.id, sessionId), eq(sessions.userId, userId))
    : eq(sessions.id, sessionId);
  return db.delete(sessions).where(where).run().changes > 0;
}

export function revokeUserSessions(userId: string, exceptSessionId?: string): number {
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
    : eq(sessions.userId, userId);
  return db.delete(sessions).where(where).run().changes;
}

export function listUserSessions(userId: string, currentSessionId?: string): SessionDTO[] {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastSeenAt))
    .all()
    .map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    }));
}

export function purgeExpiredSessions(): number {
  return db.delete(sessions).where(lte(sessions.expiresAt, now())).run().changes;
}
