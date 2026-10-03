import type { Request } from 'express';
import type { z } from 'zod';
import { badRequest, notFound } from './errors';

/** Validate untrusted input with a zod schema, throwing a 400 with field details on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read a UUID route parameter; malformed ids are reported as "not found". */
export function idParam(req: Request, name: string, what = 'Resource'): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw notFound(what);
  return value.toLowerCase();
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export function userAgent(req: Request): string | null {
  const ua = req.get('user-agent');
  return ua ? ua.slice(0, 300) : null;
}

export function queryInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function queryString(value: unknown, maxLength = 200): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maxLength) : undefined;
}
