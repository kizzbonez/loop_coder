import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRoleDTO, TaskDTO } from '@loop/shared';
import { TaskCard } from './board/TaskCard';
import { BurndownChart } from './charts/BurndownChart';
import { ConfirmProvider, useConfirm } from './ui/Confirm';
import { Markdown } from './ui/Markdown';

const task: TaskDTO = {
  id: 't1',
  projectId: 'p',
  key: 'SHOP-12',
  number: 12,
  type: 'bug',
  title: 'Checkout fails on Safari',
  description: '',
  acceptanceCriteria: '',
  priority: 'high',
  storyPoints: 5,
  columnId: 'c',
  position: 1,
  parentId: null,
  sprintId: null,
  assignedRoleId: null,
  assigneeUserId: null,
  labels: ['payments'],
  refined: true,
  bounceCount: 2,
  dependsOn: [],
  claim: null,
  createdByAgent: true,
  remarkCount: 3,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const role: AgentRoleDTO = {
  id: 'r',
  key: 'senior_developer',
  name: 'Senior Developer',
  description: '',
  instructions: '',
  color: '#22c55e',
  isSystem: true,
  enabled: true,
  assignable: true,
};

describe('TaskCard', () => {
  it('shows key, title, points, labels, rework and remark counts', () => {
    render(<TaskCard task={task} role={role} blockedBy={[]} onOpen={() => undefined} />);
    expect(screen.getByText('SHOP-12')).toBeTruthy();
    expect(screen.getByText('Checkout fails on Safari')).toBeTruthy();
    expect(screen.getByTitle('Story points').textContent).toBe('5');
    expect(screen.getByText('payments')).toBeTruthy();
    expect(screen.getByTitle(/rework 2/)).toBeTruthy();
    expect(screen.getByTitle('3 remarks')).toBeTruthy();
    expect(screen.getByText('Senior Developer')).toBeTruthy();
  });

  it('highlights items an agent is working on, naming the agent', () => {
    const claim = { by: 'token:x', agentName: 'Claude Code', roleKey: 'senior_developer', at: '', expiresAt: '' };
    const { container } = render(<TaskCard task={{ ...task, claim }} role={role} blockedBy={[]} onOpen={() => undefined} />);
    expect(screen.getByText(/Claude Code is working as Senior Developer/)).toBeTruthy();
    expect(container.querySelector('.agent-working')).not.toBeNull();
  });

  it('works for any MCP client, not just Claude', () => {
    const claim = { by: 'token:y', agentName: 'Cursor', roleKey: 'senior_developer', at: '', expiresAt: '' };
    render(<TaskCard task={{ ...task, claim }} role={role} blockedBy={[]} onOpen={() => undefined} />);
    expect(screen.getByText(/Cursor is working as Senior Developer/)).toBeTruthy();
    expect(screen.queryByText(/Claude/)).toBeNull();
  });

  it('shows open dependencies and drafts', () => {
    render(<TaskCard task={{ ...task, refined: false, type: 'story' }} blockedBy={[{ ...task, key: 'SHOP-3' }]} onOpen={() => undefined} />);
    expect(screen.getByTitle('Waiting on SHOP-3')).toBeTruthy();
    expect(screen.getByText('draft')).toBeTruthy();
  });

  it('opens on click and Enter', async () => {
    const onOpen = vi.fn();
    render(<TaskCard task={task} blockedBy={[]} onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: /SHOP-12/ });
    await userEvent.click(card);
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('Markdown (untrusted content)', () => {
  it('does not render raw HTML or scripts', () => {
    const { container } = render(<Markdown>{'Hello <img src=x onerror="alert(1)"> <script>alert(2)</script> **bold**'}</Markdown>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('opens links safely in a new tab', () => {
    render(<Markdown>{'[docs](https://example.com)'}</Markdown>);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('neutralises javascript: URLs', () => {
    render(<Markdown>{'[click](javascript:alert(1))'}</Markdown>);
    const href = screen.getByText('click').closest('a')?.getAttribute('href') ?? '';
    expect(href.startsWith('javascript:')).toBe(false);
  });

  it('renders GitHub-flavoured tables and task lists', () => {
    const { container } = render(<Markdown>{'| AC | Result |\n|---|---|\n| 1 | pass |\n\n- [x] done'}</Markdown>);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
  });
});

function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={async () => onResult(await confirm({ title: 'Delete project', message: 'Sure?', danger: true, typeToConfirm: 'SHOP' }))}>
      ask
    </button>
  );
}

describe('ConfirmProvider', () => {
  it('requires typing the confirmation text for destructive actions', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmProvider>,
    );
    await userEvent.click(screen.getByText('ask'));
    const confirmButton = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/to confirm/), 'SHOP');
    expect(confirmButton.disabled).toBe(false);
    await userEvent.click(confirmButton);
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('resolves false on cancel and Escape', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmProvider>,
    );
    await userEvent.click(screen.getByText('ask'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByText('ask'));
    await userEvent.keyboard('{Escape}');
    expect(onResult.mock.calls).toEqual([[false], [false]]);
  });
});

describe('BurndownChart', () => {
  const points = [
    { at: '2026-10-01T09:00:00Z', remainingPoints: 13 },
    { at: '2026-10-01T15:00:00Z', remainingPoints: 8 },
    { at: '2026-10-02T09:00:00Z', remainingPoints: 3 },
  ];

  it('renders an accessible chart with a data table', () => {
    render(<BurndownChart points={points} />);
    expect(screen.getByRole('img', { name: /13 points at start, 3 remaining/ })).toBeTruthy();
    const rows = screen.getByRole('table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
  });

  it('renders nothing without enough data', () => {
    const { container } = render(<BurndownChart points={points.slice(0, 1)} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows a tooltip when focused with the keyboard', async () => {
    render(<BurndownChart points={points} />);
    screen.getByRole('img').focus();
    expect(await screen.findByText('3 points remaining')).toBeTruthy();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByText('8 points remaining')).toBeTruthy();
  });
});
