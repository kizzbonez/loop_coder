import { Crown, LogOut, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@loop/shared';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Select } from '../../components/ui/Field';
import { Avatar, EmptyState, PageLoader, Section } from '../../components/ui/misc';
import { errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { ACCESS_LABEL } from '../../lib/meta';
import { useMe, useMemberMutations, useMembers } from '../../lib/queries';
import { useWorkspaceOutlet } from './WorkspaceLayout';

const ROLE_HELP: Record<WorkspaceRole, string> = {
  owner: 'Full control including members and settings',
  editor: 'Manage work items and sprints, run the agent',
  viewer: 'Read-only access to boards',
};

export function WorkspaceMembers() {
  const { workspace } = useWorkspaceOutlet();
  const members = useMembers(workspace.id);
  const me = useMe();
  const m = useMemberMutations(workspace.id);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('editor');
  const canManage = workspace.myAccess === 'owner' || workspace.myAccess === 'admin';

  if (members.isPending) return <PageLoader />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {canManage && (
        <Section title="Invite a member" description="People need an account first. Administrators can create accounts in Administration → Users.">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              m.add.mutate(
                { email: email.trim(), role },
                {
                  onSuccess: () => {
                    toast.success('Member added');
                    setEmail('');
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                },
              );
            }}
          >
            <Input type="email" placeholder="colleague@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-60 flex-1" aria-label="Email" />
            <Select value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} className="w-36" aria-label="Role">
              {WORKSPACE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ACCESS_LABEL[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="primary" icon={UserPlus} loading={m.add.isPending} disabled={!email.trim()}>
              Add
            </Button>
          </form>
          <p className="mt-2 text-xs text-subtle">{ROLE_HELP[role]}.</p>
        </Section>
      )}

      <Section title="Members" description={`${members.data?.length ?? 0} people have access to every project in this workspace.`}>
        {!members.data?.length ? (
          <EmptyState icon={Users} title="No members" />
        ) : (
          <ul className="divide-y divide-line">
            {members.data.map((member) => {
              const isOwner = member.userId === workspace.ownerId;
              const isMe = member.userId === me.data?.id;
              return (
                <li key={member.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={member.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {member.name}
                      {isOwner && (
                        <Badge tone="warning">
                          <Crown className="size-3" /> Owner
                        </Badge>
                      )}
                      {isMe && <Badge>You</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {member.email} · joined {formatDate(member.createdAt)}
                    </div>
                  </div>
                  {canManage && !isOwner ? (
                    <Select
                      value={member.role}
                      className="w-32"
                      aria-label={`Role of ${member.name}`}
                      onChange={(e) =>
                        m.update.mutate(
                          { userId: member.userId, role: e.target.value as WorkspaceRole },
                          { onSuccess: () => toast.success('Role updated'), onError: (err) => toast.error(errorMessage(err)) },
                        )
                      }
                    >
                      {WORKSPACE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ACCESS_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone="accent">{ACCESS_LABEL[member.role]}</Badge>
                  )}
                  {canManage && !isOwner && !isMe && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Crown}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: 'Transfer ownership',
                              message: `${member.name} becomes the owner of “${workspace.name}”. You keep the owner role.`,
                              confirmLabel: 'Transfer',
                            })
                          ) {
                            m.transfer.mutate(member.userId, { onError: (err) => toast.error(errorMessage(err)) });
                          }
                        }}
                      >
                        Make owner
                      </Button>
                      <IconButton
                        icon={X}
                        tone="danger"
                        label={`Remove ${member.name}`}
                        onClick={async () => {
                          if (await confirm({ title: 'Remove member', message: `Remove ${member.name} from this workspace?`, danger: true, confirmLabel: 'Remove' })) {
                            m.remove.mutate(member.userId, { onError: (err) => toast.error(errorMessage(err)) });
                          }
                        }}
                      />
                    </>
                  )}
                  {isMe && !isOwner && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={LogOut}
                      onClick={async () => {
                        if (await confirm({ title: 'Leave workspace', message: `You will lose access to “${workspace.name}”.`, danger: true, confirmLabel: 'Leave' })) {
                          m.remove.mutate(member.userId, { onSuccess: () => navigate('/'), onError: (err) => toast.error(errorMessage(err)) });
                        }
                      }}
                    >
                      Leave
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
