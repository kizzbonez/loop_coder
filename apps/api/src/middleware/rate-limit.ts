import type { Request, RequestHandler } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { ApiErrorBody } from '@loop/shared';

export interface RateLimitOptions {
  enabled: boolean;
}

const body = (message: string): ApiErrorBody => ({ error: { code: 'rate_limited', message } });

function limiter(
  opts: RateLimitOptions,
  windowMs: number,
  limit: number,
  message: string,
  keyGenerator?: (req: Request) => string,
): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => !opts.enabled,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => {
      res.status(429).json(body(message));
    },
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

/** Brute-force protection for login, registration and the setup wizard (per IP). */
export const authLimiter = (opts: RateLimitOptions) =>
  limiter(opts, 15 * 60_000, 20, 'Too many attempts. Please wait a few minutes and try again.');

/** General API budget, keyed per signed-in user (falls back to IP). */
export const apiLimiter = (opts: RateLimitOptions) =>
  limiter(opts, 60_000, 600, 'Too many requests. Slow down a little.', (req) =>
    req.identity ? `u:${req.identity.user.id}` : `ip:${ipKey(req)}`,
  );

/** MCP endpoint budget per client IP (tokens are validated after this). */
export const mcpLimiter = (opts: RateLimitOptions) =>
  limiter(opts, 60_000, 300, 'Too many MCP requests.');
