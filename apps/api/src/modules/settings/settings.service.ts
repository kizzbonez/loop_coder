import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@loop/shared';
import { db } from '../../db/client';
import { settings as settingsTable } from '../../db/schema';
import { logger } from '../../lib/logger';
import { now } from '../../lib/time';

type Section = keyof Settings;
const SECTIONS = Object.keys(DEFAULT_SETTINGS) as Section[];

let cache: Settings | null = null;

function load(): Settings {
  const rows = db.select().from(settingsTable).all();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const merged = Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      { ...DEFAULT_SETTINGS[section], ...((stored.get(section) as object | undefined) ?? {}) },
    ]),
  );
  const parsed = settingsSchema.safeParse(merged);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'stored settings invalid, falling back to defaults');
    return structuredClone(DEFAULT_SETTINGS);
  }
  return parsed.data;
}

export function getSettings(): Settings {
  cache ??= load();
  return cache;
}

export function updateSettings(next: Settings, updatedBy: string | null): Settings {
  const value = settingsSchema.parse(next);
  db.transaction((tx) => {
    for (const section of SECTIONS) {
      tx.insert(settingsTable)
        .values({ key: section, value: value[section], updatedAt: now(), updatedBy })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: value[section], updatedAt: now(), updatedBy },
        })
        .run();
    }
  });
  cache = value;
  return value;
}

/** Persist defaults for any section that is missing (first start / new settings added in an upgrade). */
export function ensureDefaultSettings(): void {
  const existing = new Set(db.select({ key: settingsTable.key }).from(settingsTable).all().map((r) => r.key));
  for (const section of SECTIONS) {
    if (!existing.has(section)) {
      db.insert(settingsTable).values({ key: section, value: DEFAULT_SETTINGS[section] }).run();
    }
  }
  cache = null;
}

export function resetSettingsCache(): void {
  cache = null;
}
