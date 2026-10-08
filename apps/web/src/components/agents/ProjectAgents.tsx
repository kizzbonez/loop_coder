import { KeyRound, Users } from 'lucide-react';
import { useState } from 'react';
import { agentDisplayName, type ApiTokenDTO, type ProjectDTO } from '@loop/shared';
import { timeAgo } from '../../lib/format';
import { useRoles, useTokens } from '../../lib/queries';
import { Badge, Chip } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Section } from '../ui/misc';
import { TokenRolesDialog } from './TokenRolesDialog';

/** A token reaches the project when it is scoped to it, to its workspace, or to everything. */
export function reachesProject(t: ApiTokenDTO, project: Pick<ProjectDTO, 'id' | 'workspaceId'>, now = Date.now()): boolean {
  if (t.revokedAt || Date.parse(t.expiresAt) <= now) return false;
  if (t.projectId) return t.projectId === project.id;
  return !t.workspaceId || t.workspaceId === project.workspaceId;
}

/** Your agents (tokens) that can work on this project, with the roles each plays and a way to change them. */
export function ProjectAgents({ project }: { project: Pick<ProjectDTO, 'id' | 'workspaceId'> }) {
  const tokens = useTokens();
  const roles = useRoles();
  const [editing, setEditing] = useState<ApiTokenDTO | null>(null);
  const colours = new Map((roles.data ?? []).map((r) => [r.key, r]));
  const mine = (tokens.data ?? []).filter((t) => reachesProject(t, project));

  return (
    <Section
      title="Your agents on this project"
      description="Each access token is one agent. Choose the roles each plays: for example one agent builds and another reviews and tests. Changes apply from the agent's next step."
    >
      {mine.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-subtle">
          <KeyRound className="size-4" /> No agents yet. Create a project token below to connect one.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {mine.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted">
                    {t.clientName ? agentDisplayName(t.clientName) : 'not connected yet'} · last used {timeAgo(t.lastUsedAt)}
                    {t.projectId ? '' : t.workspaceId ? ' · whole workspace' : ' · all your projects'}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Roles of ${t.name}`}>
                  {t.roleKeys === null ? (
                    <Badge>Every role</Badge>
                  ) : (
                    t.roleKeys.map((k) => (
                      <Chip key={k} color={colours.get(k)?.color ?? '#8b8b8b'} dot>
                        {colours.get(k)?.name ?? k}
                      </Chip>
                    ))
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" icon={Users} onClick={() => setEditing(t)} aria-label={`Roles for ${t.name}`}>
                Roles
              </Button>
            </li>
          ))}
        </ul>
      )}
      <TokenRolesDialog token={editing} onClose={() => setEditing(null)} />
    </Section>
  );
}
