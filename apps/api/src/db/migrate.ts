import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client';

/** Locate the generated SQL migrations both from src/ (dev, tests) and dist/ (production). */
function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../../drizzle'), resolve(here, '../drizzle'), resolve(process.cwd(), 'drizzle')];
  const found = candidates.find((p) => existsSync(resolve(p, 'meta/_journal.json')));
  if (!found) throw new Error(`Could not find database migrations (looked in ${candidates.join(', ')})`);
  return found;
}

/** Creates the schema on a fresh database and applies any pending migrations. Idempotent. */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: migrationsFolder() });
}
