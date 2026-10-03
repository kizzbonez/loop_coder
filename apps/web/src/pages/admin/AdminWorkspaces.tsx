import { ExternalLink, Trash } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/Badge';
import { IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { PageLoader, ProgressBar, Section } from '../../components/ui/misc';
import { errorMessage } from '../../lib/api';
import { formatDate, percent } from '../../lib/format';
import { useAdminMutations, useAdminProjects, useAdminWorkspaces } from '../../lib/queries';

const ICON_LINK = 'inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg';

export function AdminWorkspaces() {
  const workspaces = useAdminWorkspaces();
  const projects = useAdminProjects();
  const m = useAdminMutations();
  const confirm = useConfirm();
  if (workspaces.isPending || projects.isPending) return <PageLoader />;

  return (
    <div className="space-y-6">
      <Section title="Workspaces" description="Every workspace on this server. Open one to manage its members and settings as an administrator.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-subtle">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Owner</th>
                <th className="pb-2 text-right font-medium">Projects</th>
                <th className="pb-2 text-right font-medium">Members</th>
                <th className="pb-2 font-medium">Created</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(workspaces.data ?? []).map((w) => (
                <tr key={w.id}>
                  <td className="py-2.5">
                    <div className="font-medium">{w.name}</div>
                    <div className="font-mono text-xs text-subtle">/{w.slug}</div>
                  </td>
                  <td className="py-2.5 text-muted">{w.ownerName}</td>
                  <td className="py-2.5 text-right tabular-nums">{w.projectCount}</td>
                  <td className="py-2.5 text-right tabular-nums">{w.memberCount}</td>
                  <td className="py-2.5 text-muted">{formatDate(w.createdAt)}</td>
                  <td className="py-2.5 text-right">
                    <Link to={`/w/${w.id}`} aria-label={`Open ${w.name}`} title="Open" className={ICON_LINK}>
                      <ExternalLink className="size-4" />
                    </Link>
                    <IconButton
                      icon={Trash}
                      tone="danger"
                      label={`Delete ${w.name}`}
                      onClick={async () => {
                        if (await confirm({ title: `Delete ${w.name}?`, message: `${w.projectCount} projects are deleted with it.`, danger: true, confirmLabel: 'Delete', typeToConfirm: w.name })) {
                          m.deleteWorkspace.mutate(w.id, { onSuccess: () => toast.success('Workspace deleted'), onError: (e) => toast.error(errorMessage(e)) });
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Projects" description="All projects across workspaces.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-subtle">
              <tr>
                <th className="pb-2 font-medium">Project</th>
                <th className="pb-2 font-medium">Workspace</th>
                <th className="pb-2 font-medium">Agent</th>
                <th className="pb-2 font-medium">Progress</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(projects.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5">
                    <span className="mr-2 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px]">{p.key}</span>
                    <span className="font-medium">{p.name}</span>
                  </td>
                  <td className="py-2.5 text-muted">{p.workspaceName}</td>
                  <td className="py-2.5">{p.agentState === 'paused' ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Active</Badge>}</td>
                  <td className="w-48 py-2.5">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={percent(p.stats.done, p.stats.total)} />
                      <span className="text-xs text-muted tabular-nums">
                        {p.stats.done}/{p.stats.total}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right">
                    <Link to={`/p/${p.id}/board`} aria-label={`Open ${p.name}`} title="Open" className={ICON_LINK}>
                      <ExternalLink className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
