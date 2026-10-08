import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AgentRoleDTO, ApiTokenDTO } from '@loop/shared';
import { keys } from '../../lib/queries';
import { ProjectAgents, reachesProject } from './ProjectAgents';

const project = { id: 'p1', workspaceId: 'w1' };
const future = new Date(Date.now() + 864e5).toISOString();
const token = (over: Partial<ApiTokenDTO>): ApiTokenDTO => ({
  id: 't',
  name: 'Token',
  prefix: 'lc_pat_abcde',
  workspaceId: null,
  workspaceName: null,
  projectId: null,
  projectName: null,
  userId: 'u',
  roleKeys: null,
  clientName: null,
  createdAt: new Date().toISOString(),
  expiresAt: future,
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});
const role = (key: string, name: string) => ({ id: key, key, name, color: '#123456', enabled: true }) as AgentRoleDTO;

describe('ProjectAgents', () => {
  it('knows which tokens can work on a project', () => {
    expect(reachesProject(token({ projectId: 'p1' }), project)).toBe(true);
    expect(reachesProject(token({ projectId: 'p2' }), project)).toBe(false);
    expect(reachesProject(token({ workspaceId: 'w1' }), project)).toBe(true);
    expect(reachesProject(token({ workspaceId: 'w2' }), project)).toBe(false);
    expect(reachesProject(token({}), project)).toBe(true); // all my projects
    expect(reachesProject(token({ projectId: 'p1', revokedAt: new Date().toISOString() }), project)).toBe(false);
    expect(reachesProject(token({ projectId: 'p1', expiresAt: new Date(Date.now() - 1000).toISOString() }), project)).toBe(false);
  });

  it('lists your agents on the project with their tool and roles, each with a Roles button', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.roles, [role('code_reviewer', 'Code Reviewer'), role('qa_engineer', 'QA Engineer')]);
    qc.setQueryData(keys.tokens, [
      token({ id: 'a', name: 'Builder', projectId: 'p1', clientName: 'claude-code 2.1.0' }),
      token({ id: 'b', name: 'Checker', workspaceId: 'w1', roleKeys: ['code_reviewer', 'qa_engineer'] }),
      token({ id: 'c', name: 'Elsewhere', projectId: 'p9' }),
    ]);
    render(
      <QueryClientProvider client={qc}>
        <ProjectAgents project={project} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Builder')).toBeTruthy();
    expect(screen.getByText(/Claude Code · last used/)).toBeTruthy();
    expect(within(screen.getByLabelText('Roles of Builder')).getByText('Every role')).toBeTruthy();
    const checker = within(screen.getByLabelText('Roles of Checker'));
    expect(checker.getByText('Code Reviewer')).toBeTruthy();
    expect(checker.getByText('QA Engineer')).toBeTruthy();
    expect(screen.getByText(/not connected yet · last used .* · whole workspace/)).toBeTruthy();
    expect(screen.queryByText('Elsewhere')).toBeNull();
    expect(screen.getByRole('button', { name: 'Roles for Builder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Roles for Checker' })).toBeTruthy();
  });
});
