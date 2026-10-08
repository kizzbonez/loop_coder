import type { Request } from 'express';
import { agentDisplayName } from '@loop/shared';
import type { Actor } from '../lib/actor';
import { clientIp, userAgent } from '../lib/http';
import { authenticateToken } from '../modules/tokens/tokens.service';

/** Resolve the agent actor from `Authorization: Bearer lc_pat_…`, or null when the token is invalid. */
export function authenticateMcpRequest(req: Request): Actor | null {
  const header = req.get('authorization');
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const result = authenticateToken(header.replace(/^Bearer\s+/i, '').trim());
  if (!result) return null;
  return {
    kind: 'agent',
    userId: result.user.id,
    userRole: result.user.role,
    name: result.user.name,
    email: result.user.email,
    tokenId: result.token.id,
    tokenName: result.token.name,
    agentRoleKeys: result.token.roleKeys ?? null,
    // Recorded from clientInfo when the client initialised the MCP connection.
    agentName: agentDisplayName(result.token.lastClientName),
    tokenProjectId: result.token.projectId,
    tokenWorkspaceId: result.token.workspaceId,
    ip: clientIp(req),
    userAgent: userAgent(req),
  };
}
