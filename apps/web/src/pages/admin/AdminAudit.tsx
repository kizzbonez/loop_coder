import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Select } from '../../components/ui/Field';
import { EmptyState, PageLoader } from '../../components/ui/misc';
import { formatDateTime } from '../../lib/format';
import { useAudit } from '../../lib/queries';

const FILTERS: Array<[string, string]> = [
  ['', 'All events'],
  ['auth.', 'Authentication'],
  ['auth.login_failed', 'Failed logins'],
  ['auth.account_locked', 'Account lockouts'],
  ['admin.', 'Admin actions'],
  ['token.', 'Access tokens'],
  ['workspace.', 'Workspaces'],
  ['project.', 'Projects'],
  ['role.', 'Agent roles'],
  ['setup.', 'Setup'],
];

export function AdminAudit() {
  const [action, setAction] = useState('');
  const audit = useAudit(action);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-muted">Append-only record of security-relevant actions.</p>
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="ml-auto w-52" aria-label="Filter">
          {FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      {audit.isPending ? (
        <PageLoader />
      ) : !audit.data?.items.length ? (
        <EmptyState icon={ScrollText} title="No matching events" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line text-xs text-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {audit.data.items.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-muted">{formatDateTime(a.createdAt)}</td>
                  <td className="px-4 py-2">
                    <code className={a.action.includes('failed') || a.action.includes('locked') ? 'font-mono text-xs text-danger' : 'font-mono text-xs text-accent'}>{a.action}</code>
                  </td>
                  <td className="px-4 py-2 text-muted">{a.actorEmail ?? a.actorType}</td>
                  <td className="px-4 py-2 text-muted">{a.targetType ? `${a.targetType}` : '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{a.ip ?? '—'}</td>
                  <td className="max-w-xs px-4 py-2">
                    {a.metadata && <code className="block truncate font-mono text-[11px] text-subtle" title={JSON.stringify(a.metadata)}>{JSON.stringify(a.metadata)}</code>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
