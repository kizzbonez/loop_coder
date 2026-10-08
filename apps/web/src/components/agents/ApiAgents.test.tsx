import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AgentRoleDTO, AiProviderDTO, ApiAgentDTO } from '@loop/shared';
import { keys } from '../../lib/queries';
import { ConfirmProvider } from '../ui/Confirm';
import { ApiAgents } from './ApiAgents';

const now = new Date().toISOString();
const role = (key: string, name: string) => ({ id: key, key, name, color: '#123456', enabled: true }) as AgentRoleDTO;
const provider = { id: 'g', name: 'Gemini', preset: 'gemini', kind: 'openai_compatible', enabled: true, model: 'gemini-3.8-flash', models: [] } as unknown as AiProviderDTO;
const agent = (over: Partial<ApiAgentDTO>): ApiAgentDTO => ({
  id: 'a',
  projectId: 'p1',
  name: 'Gem',
  providerId: 'g',
  providerName: 'Gemini',
  providerKind: 'openai_compatible',
  model: 'gemini-3.8-flash',
  modelChoice: '',
  roleKeys: null,
  dailyTokenLimit: 2_000_000,
  maxTurnsPerStep: 60,
  canRunCommands: true,
  state: 'stopped',
  status: { activity: null, error: null, at: null },
  usageToday: { inputTokens: 0, outputTokens: 0, requests: 0 },
  createdAt: now,
  updatedAt: now,
  ...over,
});

function show(items: ApiAgentDTO[], runnerConfigured = true, providers = [provider]) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(keys.roles, [role('backend_developer', 'Backend Developer'), role('qa_engineer', 'QA Engineer')]);
  qc.setQueryData(keys.admin.aiProviders, { items: providers, secretsConfigured: true, allowedHosts: [] });
  qc.setQueryData(keys.admin.apiAgents('p1'), { items, runnerConfigured });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConfirmProvider>
          <ApiAgents project={{ id: 'p1' }} />
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ApiAgents', () => {
  it('lists API agents with their provider, model, roles, status and usage', () => {
    show([
      agent({ id: 'a', name: 'Gem', roleKeys: ['backend_developer'], state: 'running', status: { activity: 'SHOP-3: you are acting as the Backend Developer', error: null, at: now }, usageToday: { inputTokens: 12_000, outputTokens: 345, requests: 4 } }),
      agent({ id: 'b', name: 'Checker', roleKeys: ['qa_engineer'], status: { activity: 'Stopped after repeated failures', error: 'The model request failed (400): Invalid model', at: now }, canRunCommands: false }),
    ]);
    expect(screen.getByText('Gem')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(within(screen.getByLabelText('Roles of Gem')).getByText('Backend Developer')).toBeTruthy();
    expect(screen.getByText(/SHOP-3: you are acting as the Backend Developer/)).toBeTruthy();
    expect(screen.getByText(/Today: 12,345 of 2,000,000 tokens · 4 requests/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop Gem' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start Checker' })).toBeTruthy();
    expect(screen.getByText('The model request failed (400): Invalid model')).toBeTruthy();
    expect(screen.getByText(/no commands/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains what is missing: the runner, or a provider', () => {
    show([agent({})], false, []);
    expect(screen.getByRole('alert').textContent).toMatch(/npm run secrets-key/);
    expect(screen.getByRole('link', { name: 'Admin › AI providers' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add API agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Start Gem' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
