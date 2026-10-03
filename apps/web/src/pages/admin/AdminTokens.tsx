import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { EmptyState, PageLoader } from '../../components/ui/misc';
import { errorMessage } from '../../lib/api';
import { formatDate, timeAgo } from '../../lib/format';
import { useAdminMutations, useAdminTokens } from '../../lib/queries';

export function AdminTokens() {
  const tokens = useAdminTokens();
  const m = useAdminMutations();
  const confirm = useConfirm();
  if (tokens.isPending) return <PageLoader />;
  if (!tokens.data?.length) return <EmptyState icon={KeyRound} title="No access tokens" description="Users create tokens to connect AI coding agents over MCP." />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-line text-xs text-subtle">
          <tr>
            <th className="px-4 py-2.5 font-medium">Token</th>
            <th className="px-4 py-2.5 font-medium">Owner</th>
            <th className="px-4 py-2.5 font-medium">Scope</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Last used</th>
            <th className="px-4 py-2.5 font-medium">Expires</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tokens.data.map((t) => {
            const expired = new Date(t.expiresAt) < new Date();
            return (
              <tr key={t.id}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{t.name}</div>
                  <code className="font-mono text-xs text-subtle">{t.prefix}…</code>
                </td>
                <td className="px-4 py-2.5 text-muted">{t.userEmail}</td>
                <td className="px-4 py-2.5 text-muted">{t.projectName ? `Project ${t.projectName}` : t.workspaceName ? `Workspace ${t.workspaceName}` : 'All projects'}</td>
                <td className="px-4 py-2.5">{t.revokedAt ? <Badge tone="danger">Revoked</Badge> : expired ? <Badge tone="warning">Expired</Badge> : <Badge tone="success">Active</Badge>}</td>
                <td className="px-4 py-2.5 text-muted">{timeAgo(t.lastUsedAt)}</td>
                <td className="px-4 py-2.5 text-muted">{formatDate(t.expiresAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  {!t.revokedAt && !expired && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (await confirm({ title: 'Revoke token', message: `“${t.name}” of ${t.userEmail} stops working immediately.`, danger: true, confirmLabel: 'Revoke' })) {
                          m.revokeToken.mutate(t.id, { onSuccess: () => toast.success('Token revoked'), onError: (e) => toast.error(errorMessage(e)) });
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
