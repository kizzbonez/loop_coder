import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { AgentRoleDTO } from '@loop/shared';
import { keys } from '../../lib/queries';
import { RolePicker, roleSummary } from './RolePicker';

const role = (key: string, name: string, enabled = true) => ({ id: key, key, name, color: '#888888', enabled }) as AgentRoleDTO;
const ROLES = [role('code_reviewer', 'Code Reviewer'), role('qa_engineer', 'QA Engineer'), role('data_engineer', 'Data Engineer', false)];

let last: string[] | null | undefined;
function Harness({ initial }: { initial: string[] | null }) {
  const [value, setValue] = useState(initial);
  return (
    <RolePicker
      value={value}
      onChange={(v) => {
        last = v;
        setValue(v);
      }}
    />
  );
}

function show(initial: string[] | null) {
  const qc = new QueryClient();
  qc.setQueryData(keys.roles, ROLES);
  return render(
    <QueryClientProvider client={qc}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

describe('RolePicker', () => {
  it('starts with every role and lets you narrow it down to some', async () => {
    show(null);
    expect((screen.getByLabelText('Every role (one agent does everything)') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('group', { name: 'Roles' })).toBeNull();
    await userEvent.click(screen.getByLabelText('Only these roles'));
    expect(last).toEqual([]);
    expect(screen.getByText('Choose at least one role.')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('QA Engineer'));
    await userEvent.click(screen.getByLabelText('Code Reviewer'));
    expect(last).toEqual(['qa_engineer', 'code_reviewer']);
    expect(screen.queryByText('Choose at least one role.')).toBeNull();
    // Disabled roles are not offered.
    expect(screen.queryByLabelText('Data Engineer')).toBeNull();
    await userEvent.click(screen.getByLabelText('QA Engineer'));
    expect(last).toEqual(['code_reviewer']);
    await userEvent.click(screen.getByLabelText('Every role (one agent does everything)'));
    expect(last).toBeNull();
  });

  it('summarises the roles for lists', () => {
    const names = new Map(ROLES.map((r) => [r.key, r.name]));
    expect(roleSummary(null, names)).toBe('Every role');
    expect(roleSummary(['code_reviewer', 'qa_engineer'], names)).toBe('Code Reviewer, QA Engineer');
    expect(roleSummary(['retired_role'], names)).toBe('retired_role');
  });
});
