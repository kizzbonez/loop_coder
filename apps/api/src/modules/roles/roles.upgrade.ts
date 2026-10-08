import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { activities, agentPresenceLog, agentRoles, agentSessions, taskRemarks, tasks } from '../../db/schema';
import { now } from '../../lib/time';
import { DEFAULT_ROLES } from './default-roles';
import { LEGACY_PROJECT_MANAGER_INSTRUCTIONS, LEGACY_SOFTWARE_ENGINEER_INSTRUCTIONS } from './legacy-roles';

export const LEGACY_ENGINEER_KEY = 'software_engineer';
const SENIOR_KEY = 'senior_developer';

const defaults = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!;

/**
 * 0.5.0 split the Software Engineer role into Senior, Backend and Frontend Developer. An existing
 * Software Engineer becomes the Senior Developer: it is the same role row, so work items, board
 * columns and claims that used it follow, and the role keys recorded in the history are renamed
 * with it. Texts an administrator never changed are replaced by the new ones; edited texts stay.
 * The new Backend and Frontend Developer roles are then added by the normal seeding.
 * Runs on every start and does nothing once done. Returns whether it changed anything.
 */
export function upgradeLegacyRoles(): boolean {
  const legacy = db.select().from(agentRoles).where(eq(agentRoles.key, LEGACY_ENGINEER_KEY)).get();
  if (!legacy) return false;
  // Someone already made a Senior Developer role by hand: leave both as they are.
  if (db.select({ id: agentRoles.id }).from(agentRoles).where(eq(agentRoles.key, SENIOR_KEY)).get()) return false;

  const senior = defaults(SENIOR_KEY);
  const pm = defaults('project_manager');
  db.transaction((tx) => {
    tx.update(agentRoles)
      .set({
        key: SENIOR_KEY,
        name: legacy.name === 'Software Engineer' ? senior.name : legacy.name,
        description: legacy.description === 'Implements features and fixes with tests.' ? senior.description : legacy.description,
        instructions: legacy.instructions === LEGACY_SOFTWARE_ENGINEER_INSTRUCTIONS ? senior.instructions : legacy.instructions,
        updatedAt: now(),
      })
      .where(eq(agentRoles.id, legacy.id))
      .run();

    // Role keys recorded as text follow the rename, so replays and chips still find the role.
    tx.update(activities).set({ roleKey: SENIOR_KEY }).where(eq(activities.roleKey, LEGACY_ENGINEER_KEY)).run();
    tx.update(taskRemarks).set({ roleKey: SENIOR_KEY }).where(eq(taskRemarks.roleKey, LEGACY_ENGINEER_KEY)).run();
    tx.update(agentSessions).set({ currentRoleKey: SENIOR_KEY }).where(eq(agentSessions.currentRoleKey, LEGACY_ENGINEER_KEY)).run();
    tx.update(agentPresenceLog).set({ roleKey: SENIOR_KEY }).where(eq(agentPresenceLog.roleKey, LEGACY_ENGINEER_KEY)).run();
    tx.update(tasks).set({ claimRoleKey: SENIOR_KEY }).where(eq(tasks.claimRoleKey, LEGACY_ENGINEER_KEY)).run();

    // The Project Manager learns about the new roles, unless its instructions were customised.
    tx.update(agentRoles)
      .set({ instructions: pm.instructions, updatedAt: now() })
      .where(and(eq(agentRoles.key, 'project_manager'), eq(agentRoles.instructions, LEGACY_PROJECT_MANAGER_INSTRUCTIONS)))
      .run();
  });
  return true;
}
