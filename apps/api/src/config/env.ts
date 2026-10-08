import { z } from 'zod';
import { parseMasterKey } from '../lib/secrets';

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * SQLite database file. Created automatically (with all tables) on first start.
   * Use ":memory:" for throwaway databases (tests).
   */
  DATABASE_PATH: z.string().min(1).default('./data/loopcoder.db'),

  /**
   * Public origin(s) of the web app, comma-separated, e.g.
   * "https://loop-code.example.com,http://localhost:8080". The first one is the canonical URL.
   * When set, browsers may only make state-changing requests from these origins.
   */
  APP_ORIGIN: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const origins: string[] = [];
      for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
        try {
          const url = new URL(part);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
          origins.push(url.origin);
        } catch {
          ctx.addIssue({ code: 'custom', message: `"${part}" is not a valid http(s) origin` });
          return z.NEVER;
        }
      }
      return origins.length ? origins : undefined;
    }),
  /** "auto" marks cookies Secure when the request arrived over HTTPS (via a trusted proxy). */
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  /** Express "trust proxy" setting. Default trusts loopback and private networks (the nginx container). */
  TRUST_PROXY: z.string().default('loopback, uniquelocal'),
  RATE_LIMIT_ENABLED: booleanish.default(true),

  /**
   * One-time code required by the first-run setup wizard. When unset, a random code is
   * generated at startup and printed to the logs (`docker compose logs api`).
   */
  SETUP_CODE: z.string().min(8).max(128).optional(),

  /** Optional read-only mount of project workspaces for the in-app file browser. */
  WORKSPACES_DIR: z.string().optional(),

  /**
   * Master key that encrypts secrets at rest (AI provider API keys): 32 random bytes as base64
   * or 64 hex characters. Create it with `npm run secrets-key`. Kept out of the database, so a
   * database backup alone reveals no API key; back it up separately.
   */
  LOOP_SECRETS_KEY: z
    .string()
    .optional()
    .refine((value) => !value || parseMasterKey(value) !== null, 'must be 32 bytes as base64 or 64 hex characters (create one with npm run secrets-key)'),
  /** Where to write the hosts the egress gateway may reach (a volume shared with it). Unset: nothing is written. */
  EGRESS_ALLOWLIST_PATH: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Treat empty variables (e.g. `FOO=` in .env or `${FOO:-}` in compose) as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Canonical public URL (first APP_ORIGIN entry), used in setup hints. */
export const publicOrigin = env.APP_ORIGIN?.[0] ?? 'http://localhost:8080';

/**
 * Whether a browser Origin may make requests. With APP_ORIGIN configured it must be one of
 * the listed origins; otherwise it must match the Host the request was sent to.
 */
export function isAllowedOrigin(origin: string, host: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (env.APP_ORIGIN) return env.APP_ORIGIN.includes(parsed.origin);
  return Boolean(host) && parsed.host === host;
}
