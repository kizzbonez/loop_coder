import type { NextFunction, Request, Response } from 'express';
import { isAllowedOrigin } from '../config/env';
import { forbidden } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

/**
 * CSRF defence for cookie-authenticated endpoints, layered on top of SameSite=Strict cookies:
 *  1. state-changing requests must carry a custom header, which browsers only allow
 *     cross-origin after a CORS preflight (and this API never grants CORS);
 *  2. when the browser sends an Origin header it must be one of the app's own origins.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) throw forbidden('Missing or invalid CSRF header');
  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin, req.get('host'))) throw forbidden('Cross-origin request blocked');
  next();
}
