import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Application version. Docker builds inject APP_VERSION / GIT_SHA / BUILD_TIME as env vars;
 * in development we fall back to the package.json version (kept in sync across the monorepo
 * by `npm run release`).
 */
function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, '../../package.json'), resolve(here, '../package.json')]) {
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === '@loop/api' && pkg.version) return pkg.version;
    }
  }
  return '0.0.0';
}

export const versionInfo = {
  version: process.env.APP_VERSION || packageVersion(),
  commit: process.env.GIT_SHA || 'dev',
  buildTime: process.env.BUILD_TIME || null,
} as const;
