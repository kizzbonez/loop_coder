import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AgentPresenceDTO, AgentRoleDTO, AgentState, ProjectDetailDTO } from '@loop/shared';
import { AgentStatus } from './AgentStatus';

const role = { id: 'r', key: 'frontend_developer', name: 'Frontend Developer', color: '#f97316' } as AgentRoleDTO;
const working: AgentPresenceDTO = {
  online: true,
  lastSeenAt: '2026-10-08T03:00:00Z',
  clientName: 'claude-code 2.1.0',
  agentName: 'Claude Code',
  userName: 'Ada',
  currentTaskId: 't26',
  currentTaskKey: 'NT-26',
  currentRoleKey: 'frontend_developer',
  currentCeremony: null,
  currentActivity: 'Working on NT-26 as Frontend Developer',
};
const waiting: AgentPresenceDTO = { ...working, currentTaskId: null, currentTaskKey: null, currentRoleKey: null, currentActivity: 'A human paused the agent for this project.' };

function show(agentState: AgentState, agent: AgentPresenceDTO, canEdit = true) {
  const project = { id: 'p', agentState, agent } as unknown as ProjectDetailDTO;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AgentStatus project={project} rolesByKey={new Map([[role.key, role]])} canEdit={canEdit} onOpenTask={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentStatus', () => {
  it('shows who is working, with Pause and Stop', () => {
    show('active', working);
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'NT-26' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause agent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume agent' })).toBeNull();
  });

  it('says "Pausing" while the agent finishes its step, then "paused" once it waits', () => {
    const { unmount } = show('paused', working);
    expect(screen.getByText('Pausing')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'NT-26' })).toBeTruthy();
    expect(screen.getByText(/as Frontend Developer first/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume agent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeTruthy();
    unmount();
    show('paused', waiting);
    expect(screen.getByText('Agent paused')).toBeTruthy();
    expect(screen.getByText('· waiting for you to resume')).toBeTruthy();
    expect(screen.queryByText('Pausing')).toBeNull();
  });

  it('says "Stopping" while the agent finishes, and offers only Resume once stopped', () => {
    const { unmount } = show('stopped', working);
    expect(screen.getByText('Stopping')).toBeTruthy();
    unmount();
    show('stopped', { ...waiting, online: false });
    expect(screen.getByText('Agent stopped')).toBeTruthy();
    expect(screen.getByText('· resume, then start it again')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume agent' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop agent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause agent' })).toBeNull();
  });

  it('hides the controls from viewers', () => {
    show('paused', waiting, false);
    expect(screen.queryByRole('button', { name: /agent$/ })).toBeNull();
  });
});
