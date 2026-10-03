import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import type { Actor } from '../lib/actor';
import { forbidden, unauthorized } from '../lib/errors';
import { clientIp, userAgent } from '../lib/http';
import { resolveSession, SESSION_COOKIE } from '../modules/auth/sessions.service';

function cookieSecure(req: Request): boolean {
  if (env.COOKIE_SECURE === 'true') return true;
  if (env.COOKIE_SECURE === 'false') return false;
  return req.secure;
}

export function setSessionCookie(req: Request, res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure(req),
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: cookieSecure(req), path: '/' });
}

/** Attaches `req.identity` when a valid session cookie is present. Never rejects on its own. */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    const resolved = resolveSession(token);
    if (resolved) {
      req.identity = { user: resolved.user, session: resolved.session };
      if (resolved.refreshed) setSessionCookie(req, res, token, resolved.session.expiresAt);
    } else {
      clearSessionCookie(req, res);
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.identity) throw unauthorized();
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.identity) throw unauthorized();
  if (req.identity.user.role !== 'admin') throw forbidden('Administrator access required');
  next();
}

export function actorFrom(req: Request): Actor {
  if (!req.identity) throw unauthorized();
  const { user } = req.identity;
  return {
    kind: 'user',
    userId: user.id,
    userRole: user.role,
    name: user.name,
    email: user.email,
    ip: clientIp(req),
    userAgent: userAgent(req),
  };
}
