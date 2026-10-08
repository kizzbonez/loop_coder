import type { UserRole } from '@loop/shared';

/**
 * Who is performing an operation. Humans act through the web UI (session cookie);
 * the agent acts through the MCP server with a personal access token.
 */
export interface Actor {
  kind: 'user' | 'agent';
  userId: string;
  userRole: UserRole;
  name: string;
  email: string;
  /** Present for agent actors. */
  tokenId?: string;
  /** Friendly name of the MCP client acting as the agent (e.g. "Claude Code", "Cursor"). */
  agentName?: string;
  /** The name its owner gave the token; names the agent's git worktree. */
  tokenName?: string;
  /** The roles this agent plays; null or absent means every role. */
  agentRoleKeys?: string[] | null;
  /** Scope restrictions carried by the token, if any. */
  tokenWorkspaceId?: string | null;
  tokenProjectId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Stable identifier used for work-item claims. */
export function claimantOf(actor: Actor): string {
  return actor.kind === 'agent' && actor.tokenId ? `token:${actor.tokenId}` : `user:${actor.userId}`;
}

/** Whether this actor may work in a role (humans and unrestricted agents may work in any). */
export function playsRole(actor: Actor, roleKey: string): boolean {
  return !actor.agentRoleKeys || actor.agentRoleKeys.includes(roleKey);
}

export const isAdmin = (actor: Pick<Actor, 'userRole'>): boolean => actor.userRole === 'admin';
