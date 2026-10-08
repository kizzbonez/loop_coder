import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityDTO, AgentRoleDTO, ColumnDTO, ColumnKind, PresenceEntryDTO, ProjectDetailDTO, ReplayDTO, TaskDTO } from '@loop/shared';
import { keys } from '../../../lib/queries';
import type { ProjectContext } from '../context';
import { FlowView } from './FlowView';

const P = 'p1';
const KINDS: ColumnKind[] = ['backlog', 'todo', 'in_progress', 'review', 'testing', 'blocked', 'done'];
const NAMES: Record<ColumnKind, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Code Review',
  testing: 'QA / Testing',
  blocked: 'Needs Human',
  done: 'Done',
};
const columns: ColumnDTO[] = KINDS.map((kind, i) => ({
  id: `c-${kind}`,
  projectId: P,
  key: kind,
  name: NAMES[kind],
  kind,
  position: i,
  agentRoleId: kind === 'review' ? 'r-rev' : kind === 'backlog' ? 'r-pm' : null,
  roleSource: kind === 'in_progress' ? 'task' : 'column',
  wipLimit: kind === 'in_progress' ? 2 : null,
  color: null,
}));
const roles: AgentRoleDTO[] = [
  { id: 'r-pm', key: 'project_manager', name: 'Project Manager', description: '', instructions: '', color: '#6d4aff', isSystem: true, enabled: true, assignable: false },
  { id: 'r-rev', key: 'code_reviewer', name: 'Code Reviewer', description: '', instructions: '', color: '#f59e0b', isSystem: true, enabled: true, assignable: false },
  { id: 'r-eng', key: 'senior_developer', name: 'Senior Developer', description: '', instructions: '', color: '#10b981', isSystem: true, enabled: true, assignable: true },
];
const task = (id: string, key: string, kind: ColumnKind, title: string): TaskDTO =>
  ({ id, projectId: P, key, number: 1, type: 'story', title, columnId: `c-${kind}`, position: 1, storyPoints: 3, dependsOn: [], claim: null, labels: [] }) as unknown as TaskDTO;
const tasks = [task('t1', 'SHOP-1', 'review', 'Checkout'), task('t2', 'SHOP-2', 'backlog', 'Search')];

let seq = 0;
const activity = (over: Partial<ActivityDTO>): ActivityDTO => ({
  id: `a${++seq}`,
  projectId: P,
  taskId: null,
  taskKey: null,
  actorType: 'agent',
  actorUserId: 'u',
  actorName: 'Claude Code',
  roleKey: null,
  action: 'task.moved',
  message: '',
  fromKind: null,
  toKind: null,
  ceremony: null,
  createdAt: new Date(Date.UTC(2026, 0, 1, 10, 0, seq)).toISOString(),
  ...over,
});

// Newest first, as the API returns it: SHOP-1 went To Do → In Progress → Code Review.
const history = [
  activity({ taskId: 't1', taskKey: 'SHOP-1', fromKind: 'todo', toKind: 'in_progress', roleKey: 'senior_developer', message: 'moved' }),
  activity({ taskId: 't1', taskKey: 'SHOP-1', fromKind: 'in_progress', toKind: 'review', roleKey: 'senior_developer', message: 'moved' }),
].reverse();

// What the server records for a replay: the moves above, and where the agent was (presence log).
const presenceRow = (at: string, roleKey: string, activity: string): PresenceEntryDTO => ({
  sessionId: 'sess-1',
  agentName: 'Claude Code',
  userName: 'Ada',
  at,
  taskId: 't1',
  taskKey: 'SHOP-1',
  roleKey,
  ceremony: null,
  activity,
});
const segments: ReplayDTO['segments'] = [
  { id: 'all', label: 'Whole project', detail: null, from: '2026-01-01T09:59:00.000Z', to: '2026-01-01T10:05:00.000Z' },
  { id: 'kickoff', label: 'Kickoff', detail: null, from: '2026-01-01T09:59:00.000Z', to: '2026-01-01T10:00:00.000Z' },
  { id: 'sprint-1', label: 'Sprint 1', detail: 'Checkout works', from: '2026-01-01T10:00:00.000Z', to: null },
];
const replayData: ReplayDTO = {
  segments,
  segment: segments[0]!,
  events: history,
  remarks: [],
  presence: [
    presenceRow('2026-01-01T10:00:01.000Z', 'senior_developer', 'Working on SHOP-1 as Senior Developer'),
    presenceRow('2026-01-01T10:00:02.000Z', 'code_reviewer', 'Reviewing SHOP-1'),
  ],
  presenceSince: '2026-01-01T10:00:01.000Z',
  onlineWindowMinutes: 10,
  truncated: false,
};

const project = {
  id: P,
  key: 'SHOP',
  name: 'Shop',
  columns,
  kickoffCompletedAt: '2026-01-01T00:00:00Z',
  activeSprint: { id: 's1' },
  agentState: 'active',
  agent: { online: true },
  agents: [
    {
      id: 'sess-1',
      agentName: 'Claude Code',
      clientName: 'claude-code',
      userName: 'Ada',
      lastSeenAt: '2026-01-01T10:00:00Z',
      currentTaskId: 't1',
      currentTaskKey: 'SHOP-1',
      currentRoleKey: 'code_reviewer',
      currentCeremony: null,
      currentActivity: 'Reviewing SHOP-1',
    },
  ],
} as unknown as ProjectDetailDTO;

const ctx: ProjectContext = { project, tasks, roles, stream: 'live', canEdit: true, isOwner: true };

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

let qc: QueryClient;
function renderFlow(path = `/p/${P}/flow`) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:projectId" element={<Outlet context={ctx} />}>
            <Route path="flow" element={<FlowView />} />
          </Route>
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(keys.flow(P), history);
  qc.setQueryData(keys.replay(P, 'all'), replayData);
  qc.setQueryData(keys.replay(P, 'sprint-1'), { ...replayData, segment: segments[2]! });
});
const position = () => Number((screen.getByRole('slider', { name: 'Replay position' }) as HTMLInputElement).value);

describe('FlowView', () => {
  it('draws every stage with its count, the Scrum loop and the agents', () => {
    renderFlow();
    expect(screen.getByRole('button', { name: 'Code Review: 1 item, an agent is working here' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Backlog: 1 item' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Needs Human: 0 items' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sprint planning' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claude Code · Code Reviewer, on SHOP-1' })).toBeTruthy();
    const agents = screen.getByRole('heading', { name: 'Agents online · 1' }).closest('section')!;
    expect(within(agents).getByText('“Reviewing SHOP-1”')).toBeTruthy();
    // The rework path shows how often it was taken.
    expect(document.querySelector('[data-edge="review->in_progress"]')).toBeTruthy();
  });

  it('shows the live feed and adds events as they arrive', async () => {
    renderFlow();
    const feed = screen.getByRole('log', { name: 'Flow events' });
    expect(within(feed).getAllByRole('listitem')).toHaveLength(2);
    act(() => {
      qc.setQueryData<ActivityDTO[]>(keys.flow(P), (old) => [
        activity({ taskId: 't1', taskKey: 'SHOP-1', fromKind: 'review', toKind: 'testing', roleKey: 'code_reviewer' }),
        ...old!,
      ]);
    });
    await waitFor(() => expect(within(feed).getAllByRole('listitem')).toHaveLength(3));
    expect(within(feed).getAllByRole('listitem')[0]!.textContent).toContain('Code Review');
    expect(within(feed).getAllByRole('listitem')[0]!.textContent).toContain('QA / Testing');
  });

  it('lists the items of a stage and opens them', async () => {
    renderFlow();
    await userEvent.click(screen.getByRole('button', { name: /^Code Review: 1 item/ }));
    const panel = screen.getByRole('heading', { name: 'Code Review' }).closest('section')!;
    expect(within(panel).getByText('Worked by the Code Reviewer.')).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: /SHOP-1\s*Checkout/ }));
    expect(screen.getByTestId('where').textContent).toContain('task=t1');
  });

  it('replays the history on a real clock, from what was recorded', async () => {
    renderFlow();
    await userEvent.click(screen.getByRole('radio', { name: 'Replay' }));
    expect(screen.getByTestId('where').textContent).toContain('replay=all');
    // At the start (09:59) SHOP-1 was still in To Do, and no agent was there yet.
    expect(screen.getByRole('button', { name: 'To Do: 1 item' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Code Review: 0 items' })).toBeTruthy();
    expect(screen.getByText('Press play to replay the history.')).toBeTruthy();
    expect(position()).toBe(Date.parse('2026-01-01T09:59:00Z'));
    expect(screen.getByText(/0:00 \/ 6:00/)).toBeTruthy();
    // Before the presence log starts, agents are inferred, and the bar says so.
    expect(screen.getByText(/inferred from their actions/)).toBeTruthy();

    // Next moment: 10:00:01, the first move, with the agent exactly where it was recorded.
    await userEvent.click(screen.getByRole('button', { name: 'Next moment' }));
    expect(position()).toBe(Date.parse('2026-01-01T10:00:01Z'));
    expect(screen.getByRole('button', { name: /^In Progress: 1 item/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claude Code · Senior Developer, on SHOP-1' })).toBeTruthy();
    expect(screen.queryByText(/inferred from their actions/)).toBeNull();
    const agents = screen.getByRole('heading', { name: 'Agents at this moment' }).closest('section')!;
    expect(within(agents).getByText('“Working on SHOP-1 as Senior Developer”')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Next moment' }));
    expect(screen.getByRole('button', { name: /^Code Review: 1 item/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claude Code · Code Reviewer, on SHOP-1' })).toBeTruthy();
    // Nothing more happened: the next step is the end of the segment.
    await userEvent.click(screen.getByRole('button', { name: 'Next moment' }));
    expect(position()).toBe(Date.parse('2026-01-01T10:05:00Z'));
    expect((screen.getByRole('button', { name: 'Next moment' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Previous moment' }));
    expect(position()).toBe(Date.parse('2026-01-01T10:00:02Z'));

    // Each sprint has its own replay.
    const what = screen.getByRole('combobox', { name: 'What to replay' }) as HTMLSelectElement;
    expect([...what.options].map((o) => o.textContent)).toEqual(['Whole project', 'Kickoff', 'Sprint 1 (ongoing)']);
    await userEvent.selectOptions(what, 'sprint-1');
    expect(screen.getByTestId('where').textContent).toContain('replay=sprint-1');
    // The sprint plays from its own start (10:00), with the board as it was then.
    await waitFor(() => expect(position()).toBe(Date.parse('2026-01-01T10:00:00Z')));
    expect(screen.getByText('“Checkout works”')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'To Do: 1 item' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Back to live/ }));
    expect(screen.getByTestId('where').textContent).not.toContain('replay');
  });

  it('follows one item on its journey', async () => {
    renderFlow(`/p/${P}/flow?replay=t1`);
    expect(screen.getByText('Following')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'What to replay' })).toBeNull();
    const journey = screen.getByRole('heading', { name: 'Journey' }).closest('section')!;
    const steps = within(journey).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0]!.textContent).toContain('To Do');
    expect(steps[0]!.textContent).toContain('In Progress');
    expect(steps[0]!.textContent).toMatch(/1s/); // time spent before the next move
    await userEvent.click(within(steps[1]!).getByRole('button'));
    expect(position()).toBe(Date.parse('2026-01-01T10:00:02Z'));
  });
});
