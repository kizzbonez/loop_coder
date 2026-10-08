import { runMigrations } from './db/migrate';
import { announceSetupIfRequired } from './modules/auth/auth.service';
import { purgeExpiredSessions } from './modules/auth/sessions.service';
import { seedDefaultRoles } from './modules/roles/roles.service';
import { upgradeLegacyRoles } from './modules/roles/roles.upgrade';
import { ensureDefaultSettings } from './modules/settings/settings.service';

/**
 * Prepare the database: on a fresh install this creates the SQLite file, all tables,
 * default settings and the built-in agent roles. Safe to run on every start.
 */
export function bootstrap(): void {
  runMigrations();
  ensureDefaultSettings();
  upgradeLegacyRoles(); // before seeding: Software Engineer becomes the Senior Developer (0.5.0)
  seedDefaultRoles();
  purgeExpiredSessions();
}

export { announceSetupIfRequired };
