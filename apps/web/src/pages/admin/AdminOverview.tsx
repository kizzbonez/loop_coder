import { Bot, Building, CircleCheck, KeyRound, Shield, ShieldAlert, SquareKanban, Users } from 'lucide-react';
import { Link } from 'react-router';
import { PageLoader, Section, StatCard } from '../../components/ui/misc';
import { timeAgo } from '../../lib/format';
import { useAdminAgentSessions, useAdminStats, useAudit } from '../../lib/queries';

export function AdminOverview() {
  const stats = useAdminStats();
  const agents = useAdminAgentSessions();
  const audit = useAudit('');
  if (stats.isPending) return <PageLoader />;
  const s = stats.data!;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Users" value={s.users} hint={`${s.activeUsers} active · ${s.admins} admins`} />
        <StatCard icon={Building} label="Workspaces" value={s.workspaces} hint={`${s.projects} projects`} />
        <StatCard icon={CircleCheck} label="Work items done" value={`${s.tasksDone}/${s.tasks}`} />
        <StatCard icon={Bot} label="Agents online" value={s.onlineAgents} hint={`${s.activeTokens} active tokens`} />
        <StatCard icon={Shield} label="Sessions (24h)" value={s.sessions24h} />
        <StatCard icon={ShieldAlert} label="Failed logins (24h)" value={s.failedLogins24h} />
        <StatCard icon={SquareKanban} label="Projects" value={s.projects} />
        <StatCard icon={KeyRound} label="Active tokens" value={s.activeTokens} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Agent activity" actions={<Link to="/admin/agents" className="text-xs text-accent hover:underline">All sessions</Link>}>
          <ul className="divide-y divide-line">
            {(agents.data ?? []).slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className={a.online ? 'size-2 rounded-full bg-success' : 'size-2 rounded-full bg-subtle'} />
                <span className="font-medium">{a.projectName}</span>
                <span className="truncate text-muted">{a.agentName} · {a.userName}</span>
                <span className="ml-auto text-xs text-subtle">{timeAgo(a.lastSeenAt)}</span>
              </li>
            ))}
            {agents.data?.length === 0 && <li className="py-2 text-[13px] text-subtle">No agent has connected yet.</li>}
          </ul>
        </Section>
        <Section title="Recent security events" actions={<Link to="/admin/audit" className="text-xs text-accent hover:underline">Audit log</Link>}>
          <ul className="divide-y divide-line">
            {(audit.data?.items ?? []).slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
                <code className="font-mono text-xs text-accent">{a.action}</code>
                <span className="truncate text-muted">{a.actorEmail ?? a.actorType}</span>
                <span className="ml-auto text-xs text-subtle">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
