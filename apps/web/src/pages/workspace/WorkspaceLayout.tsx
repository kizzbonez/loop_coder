import { Settings, SquareKanban, Users } from 'lucide-react';
import { Outlet, useOutletContext, useParams } from 'react-router';
import type { WorkspaceDTO } from '@loop/shared';
import { Badge } from '../../components/ui/Badge';
import { PageLoader, TabNav } from '../../components/ui/misc';
import { ACCESS_LABEL } from '../../lib/meta';
import { useWorkspace } from '../../lib/queries';
import { NotFound } from '../NotFound';

export function useWorkspaceOutlet() {
  return useOutletContext<{ workspace: WorkspaceDTO }>();
}

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const ws = useWorkspace(workspaceId);
  if (ws.isPending) return <PageLoader />;
  if (!ws.data) return <NotFound what="workspace" />;
  const workspace = ws.data;
  const canManage = workspace.myAccess === 'owner' || workspace.myAccess === 'admin';

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-surface px-6 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="brand-gradient flex size-10 items-center justify-center rounded-xl text-base font-bold text-white">
            {workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{workspace.name}</h1>
            <p className="truncate text-[13px] text-muted">{workspace.description || `/${workspace.slug}`}</p>
          </div>
          <Badge tone="accent" className="ml-auto">
            {ACCESS_LABEL[workspace.myAccess]}
          </Badge>
        </div>
        <TabNav
          className="mt-4"
          items={[
            { to: `/w/${workspace.id}`, label: 'Projects', icon: SquareKanban, end: true },
            { to: `/w/${workspace.id}/members`, label: 'Members', icon: Users },
            ...(canManage ? [{ to: `/w/${workspace.id}/settings`, label: 'Settings', icon: Settings }] : []),
          ]}
        />
      </header>
      {/* Keyed so per-workspace forms reset when switching workspaces. */}
      <div key={workspace.id} className="flex-1 p-6">
        <Outlet context={{ workspace }} />
      </div>
    </div>
  );
}
