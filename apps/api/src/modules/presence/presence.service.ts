import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { agentDisplayName, type AgentPresenceDTO, type AgentSessionDTO, type Ceremony, type OnlineAgentDTO } from '@loop/shared';
import { db } from '../../db/client';
import { agentSessions, apiTokens, projects, tasks, users } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { addMinutes, now } from '../../lib/time';
import { publish } from '../../realtime/bus';
import { getSettings } from '../settings/settings.service';

export interface PresenceUpdate {
  /** undefined = keep, null = clear */
  taskId?: string | null;
  roleKey?: string | null;
  ceremony?: Ceremony | null;
  activity?: string | null;
  completedItem?: boolean;
}

const onlineSince = () => addMinutes(now(), -getSettings().agent.onlineWindowMinutes);

const OFFLINE: AgentPresenceDTO = {
  online: false,
  lastSeenAt: null,
  clientName: null,
  agentName: null,
  userName: null,
  currentTaskId: null,
  currentTaskKey: null,
  currentRoleKey: null,
  currentCeremony: null,
  currentActivity: null,
};

export function getPresence(projectId: string): AgentPresenceDTO {
  const row = db
    .select({
      session: agentSessions,
      userName: users.name,
      taskNumber: tasks.number,
      projectKey: projects.key,
    })
    .from(agentSessions)
    .innerJoin(users, eq(users.id, agentSessions.userId))
    .innerJoin(projects, eq(projects.id, agentSessions.projectId))
    .leftJoin(tasks, eq(tasks.id, agentSessions.currentTaskId))
    .where(eq(agentSessions.projectId, projectId))
    .orderBy(desc(agentSessions.lastSeenAt))
    .limit(1)
    .get();
  if (!row) return OFFLINE;
  const { session } = row;
  return {
    online: session.lastSeenAt > onlineSince(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    clientName: session.clientName,
    agentName: agentDisplayName(session.clientName),
    userName: row.userName,
    currentTaskId: session.currentTaskId,
    currentTaskKey: row.taskNumber != null ? `${row.projectKey}-${row.taskNumber}` : null,
    currentRoleKey: session.currentRoleKey,
    currentCeremony: session.currentCeremony,
    currentActivity: session.currentActivity,
  };
}

/** Agents online on a project: the latest session of each token seen within the online window. */
export function listOnlineAgents(projectId: string): OnlineAgentDTO[] {
  const rows = db
    .select({ session: agentSessions, userName: users.name, taskNumber: tasks.number, projectKey: projects.key })
    .from(agentSessions)
    .innerJoin(users, eq(users.id, agentSessions.userId))
    .innerJoin(projects, eq(projects.id, agentSessions.projectId))
    .leftJoin(tasks, eq(tasks.id, agentSessions.currentTaskId))
    .where(and(eq(agentSessions.projectId, projectId), gt(agentSessions.lastSeenAt, onlineSince())))
    .orderBy(desc(agentSessions.lastSeenAt))
    .all();
  const seen = new Set<string>();
  const agents: OnlineAgentDTO[] = [];
  for (const { session, userName, taskNumber, projectKey } of rows) {
    if (seen.has(session.tokenId)) continue;
    seen.add(session.tokenId);
    agents.push({
      id: session.id,
      agentName: agentDisplayName(session.clientName),
      clientName: session.clientName,
      userName,
      lastSeenAt: session.lastSeenAt.toISOString(),
      currentTaskId: session.currentTaskId,
      currentTaskKey: taskNumber != null ? `${projectKey}-${taskNumber}` : null,
      currentRoleKey: session.currentRoleKey,
      currentCeremony: session.currentCeremony,
      currentActivity: session.currentActivity,
    });
  }
  return agents;
}

/**
 * Record that the agent (an MCP client) is active on a project. Calls within the online window
 * extend the current agent session; a longer gap starts a new one.
 */
export function touchPresence(actor: Actor, projectId: string, update: PresenceUpdate = {}): void {
  if (actor.kind !== 'agent' || !actor.tokenId) return;
  const t = now();
  const current = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.tokenId, actor.tokenId),
        eq(agentSessions.projectId, projectId),
        gt(agentSessions.lastSeenAt, onlineSince()),
      ),
    )
    .orderBy(desc(agentSessions.lastSeenAt))
    .get();

  const fields = {
    lastSeenAt: t,
    ...(update.taskId !== undefined ? { currentTaskId: update.taskId } : {}),
    ...(update.roleKey !== undefined ? { currentRoleKey: update.roleKey } : {}),
    ...(update.ceremony !== undefined ? { currentCeremony: update.ceremony } : {}),
    ...(update.activity !== undefined ? { currentActivity: update.activity?.slice(0, 300) ?? null } : {}),
  };

  if (current) {
    db.update(agentSessions)
      .set({
        ...fields,
        toolCalls: sql`${agentSessions.toolCalls} + 1`,
        ...(update.completedItem ? { itemsCompleted: sql`${agentSessions.itemsCompleted} + 1` } : {}),
      })
      .where(eq(agentSessions.id, current.id))
      .run();
  } else {
    const token = db
      .select({ clientName: apiTokens.lastClientName })
      .from(apiTokens)
      .where(eq(apiTokens.id, actor.tokenId))
      .get();
    db.insert(agentSessions)
      .values({
        projectId,
        userId: actor.userId,
        tokenId: actor.tokenId,
        clientName: token?.clientName ?? null,
        startedAt: t,
        toolCalls: 1,
        itemsCompleted: update.completedItem ? 1 : 0,
        ...fields,
      })
      .run();
  }
  publish(projectId, { type: 'agent.presence', agent: getPresence(projectId), agents: listOnlineAgents(projectId) });
}

export function listAgentSessions(opts: { projectId?: string; limit: number }): AgentSessionDTO[] {
  const since = onlineSince();
  return db
    .select({ session: agentSessions, userName: users.name, projectName: projects.name })
    .from(agentSessions)
    .innerJoin(users, eq(users.id, agentSessions.userId))
    .innerJoin(projects, eq(projects.id, agentSessions.projectId))
    .where(opts.projectId ? eq(agentSessions.projectId, opts.projectId) : undefined)
    .orderBy(desc(agentSessions.lastSeenAt))
    .limit(opts.limit)
    .all()
    .map(({ session, userName, projectName }) => ({
      id: session.id,
      projectId: session.projectId,
      projectName,
      userId: session.userId,
      userName,
      tokenId: session.tokenId,
      clientName: session.clientName,
      agentName: agentDisplayName(session.clientName),
      startedAt: session.startedAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      toolCalls: session.toolCalls,
      itemsCompleted: session.itemsCompleted,
      online: session.lastSeenAt > since,
    }));
}

/** Number of distinct agents (MCP connections, one per token) active within the online window. */
export function countOnlineAgents(): number {
  const rows = db
    .select({ tokenId: agentSessions.tokenId })
    .from(agentSessions)
    .where(gt(agentSessions.lastSeenAt, onlineSince()))
    .groupBy(agentSessions.tokenId)
    .all();
  return rows.length;
}
