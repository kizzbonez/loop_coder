import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '../config/env';
import * as schema from './schema';

function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') {
    // First run: create the data directory; SQLite creates the file itself.
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  return sqlite;
}

export const sqlite = openDatabase(env.DATABASE_PATH);
export const db = drizzle(sqlite, { schema });

export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Executor = DB | Tx;

export function closeDatabase(): void {
  if (sqlite.open) sqlite.close();
}
