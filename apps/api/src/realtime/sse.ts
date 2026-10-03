import type { Request, Response } from 'express';
import { versionInfo } from '../config/version';
import type { Actor } from '../lib/actor';
import { tooManyRequests } from '../lib/errors';
import { getProjectAccess } from '../modules/projects/access';
import { resolveSession, SESSION_COOKIE } from '../modules/auth/sessions.service';
import { subscribe } from './bus';

const HEARTBEAT_MS = 20_000;
const REAUTH_MS = 60_000;
const MAX_STREAMS_PER_USER = 20;
const openStreams = new Map<string, number>();

/**
 * Server-Sent Events stream of a project's board changes. The session and project access are
 * re-validated periodically so revoked sessions and removed members are disconnected.
 */
export function streamProjectEvents(req: Request, res: Response, actor: Actor, projectId: string): void {
  const current = openStreams.get(actor.userId) ?? 0;
  if (current >= MAX_STREAMS_PER_USER) throw tooManyRequests('Too many open live connections');
  openStreams.set(actor.userId, current + 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ version: versionInfo.version, commit: versionInfo.commit })}\n\n`);

  const unsubscribe = subscribe(projectId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const cookie = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const reauth = setInterval(() => {
    if (!resolveSession(cookie) || !getProjectAccess(actor, projectId)) close();
  }, REAUTH_MS);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(reauth);
    unsubscribe();
    const left = (openStreams.get(actor.userId) ?? 1) - 1;
    if (left <= 0) openStreams.delete(actor.userId);
    else openStreams.set(actor.userId, left);
    res.end();
  }
  req.on('close', close);
}
