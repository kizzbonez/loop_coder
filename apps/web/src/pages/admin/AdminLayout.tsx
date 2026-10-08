import { Bot, Building, Cpu, Database, KeyRound, LayoutDashboard, ScrollText, Settings, Shield, Users, Workflow } from 'lucide-react';
import { Outlet } from 'react-router';
import { TabNav } from '../../components/ui/misc';

export function AdminLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-surface px-6 pt-6">
        <div className="flex items-center gap-3">
          <span className="brand-gradient flex size-10 items-center justify-center rounded-xl text-white">
            <Shield className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Administration</h1>
            <p className="text-[13px] text-muted">Users, workspaces, agent roles, security and system health</p>
          </div>
        </div>
        <TabNav
          className="mt-4"
          items={[
            { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
            { to: '/admin/users', label: 'Users', icon: Users },
            { to: '/admin/workspaces', label: 'Workspaces', icon: Building },
            { to: '/admin/roles', label: 'Agent roles', icon: Workflow },
            { to: '/admin/agents', label: 'Agent sessions', icon: Bot },
            { to: '/admin/ai-providers', label: 'AI providers', icon: Cpu },
            { to: '/admin/tokens', label: 'Tokens', icon: KeyRound },
            { to: '/admin/settings', label: 'Settings', icon: Settings },
            { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
            { to: '/admin/system', label: 'System', icon: Database },
          ]}
        />
      </header>
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
