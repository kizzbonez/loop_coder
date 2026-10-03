import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

/** Minimal access log; deliberately excludes headers, bodies and query strings (may contain secrets). */
const QUIET_PATHS = new Set(['/healthz', '/api/health', '/api/version']);

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  if (QUIET_PATHS.has(req.path)) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({ method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, 'request');
  });
  next();
}
