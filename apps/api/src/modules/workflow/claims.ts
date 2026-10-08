import { inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { projects, tasks } from '../../db/schema';
import { EventBatch } from '../../realtime/bus';
import { getTaskDTO } from '../tasks/tasks.query';
import { CLEAR_CLAIM } from '../tasks/tasks.service';

/**
 * Hand back the work items and ceremonies held by revoked tokens (a deleted API agent, a revoked
 * token, a disabled user), so other agents can take them at once instead of after the claim
 * timeout. Agents waiting for work are woken by the task events. Returns how many items were freed.
 */
export function releaseClaimsOfTokens(tokenIds: string[]): number {
  if (tokenIds.length === 0) return 0;
  const claimants = tokenIds.map((id) => `token:${id}`);
  const batch = new EventBatch();
  const released = db.transaction((tx) => {
    const held = tx.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(inArray(tasks.claimedBy, claimants)).all();
    if (held.length > 0) tx.update(tasks).set(CLEAR_CLAIM).where(inArray(tasks.claimedBy, claimants)).run();
    for (const task of held) batch.add(task.projectId, { type: 'task.upserted', task: getTaskDTO(tx, task.id) });
    tx.update(projects).set({ ceremonyClaimBy: null, ceremonyClaimExpiresAt: null }).where(inArray(projects.ceremonyClaimBy, claimants)).run();
    return held.length;
  });
  batch.flush();
  return released;
}
