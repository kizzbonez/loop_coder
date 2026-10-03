import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@loop/shared';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';

function send(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  res.status(status).json(body);
}

export function notFoundHandler(_req: Request, res: Response): void {
  send(res, 404, 'not_found', 'Endpoint not found');
}

// Express recognises error handlers by their 4-argument signature.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    send(res, err.status, err.code, err.message, err.details);
    return;
  }

  const e = err as { type?: string; code?: string; status?: number };
  if (e.type === 'entity.parse.failed') return send(res, 400, 'bad_request', 'Malformed JSON body');
  if (e.type === 'entity.too.large') return send(res, 413, 'payload_too_large', 'Request body is too large');
  if (typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) {
    const status = e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ? 400 : 409;
    return send(res, status, status === 409 ? 'conflict' : 'bad_request', 'The change conflicts with existing data');
  }

  logger.error({ err, method: req.method, path: req.path }, 'unhandled error');
  send(res, 500, 'internal', 'Internal server error');
}
