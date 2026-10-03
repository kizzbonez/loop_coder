import { Bot } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, PageLoader } from '../../components/ui/misc';
import { formatDateTime, timeAgo } from '../../lib/format';
import { useAdminAgentSessions } from '../../lib/queries';

export function AdminAgents() {
  const sessions = useAdminAgentSessions();
  if (sessions.isPending) return <PageLoader />;
  if (!sessions.data?.length) return <EmptyState icon={Bot} title="No agent sessions yet" description="Sessions appear when an AI agent connects to a project over MCP." />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-line text-xs text-subtle">
          <tr>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Project</th>
            <th className="px-4 py-2.5 font-medium">Agent</th>
            <th className="px-4 py-2.5 font-medium">On behalf of</th>
            <th className="px-4 py-2.5 font-medium">Started</th>
            <th className="px-4 py-2.5 font-medium">Last seen</th>
            <th className="px-4 py-2.5 text-right font-medium">Tool calls</th>
            <th className="px-4 py-2.5 text-right font-medium">Items done</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sessions.data.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-2.5">{s.online ? <Badge tone="success">Online</Badge> : <Badge>Ended</Badge>}</td>
              <td className="px-4 py-2.5">
                <Link to={`/p/${s.projectId}/board`} className="font-medium hover:text-accent">
                  {s.projectName}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-muted" title={s.clientName ?? undefined}>{s.agentName}</td>
              <td className="px-4 py-2.5 text-muted">{s.userName}</td>
              <td className="px-4 py-2.5 text-muted">{formatDateTime(s.startedAt)}</td>
              <td className="px-4 py-2.5 text-muted">{timeAgo(s.lastSeenAt)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{s.toolCalls}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{s.itemsCompleted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
