import { Ellipsis, KeyRound, LockOpen, LogOut, Plus, Search, Shield, ShieldOff, Trash, UserCheck, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { UserDTO } from '@loop/shared';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Select } from '../../components/ui/Field';
import { Menu } from '../../components/ui/Menu';
import { Modal } from '../../components/ui/Modal';
import { Avatar, PageLoader } from '../../components/ui/misc';
import { ApiError, errorMessage } from '../../lib/api';
import { formatDate, timeAgo } from '../../lib/format';
import { useAdminMutations, useAdminUsers, useMe } from '../../lib/queries';

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useAdminMutations();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' as 'user' | 'admin' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create user"
      description="Share the initial password securely; the user can change it under Account."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={m.createUser.isPending}
            onClick={() =>
              m.createUser.mutate(form, {
                onSuccess: () => {
                  toast.success('User created');
                  setForm({ name: '', email: '', password: '', role: 'user' });
                  onClose();
                },
                onError: (e) => {
                  if (e instanceof ApiError) setErrors(e.fieldErrors());
                  toast.error(errorMessage(e));
                },
              })
            }
          >
            Create user
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Email" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Initial password" type="password" autoComplete="new-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Select label="Platform role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'user' | 'admin' })}>
          <option value="user">User</option>
          <option value="admin">Administrator</option>
        </Select>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserDTO | null; onClose: () => void }) {
  const m = useAdminMutations();
  const [password, setPassword] = useState('');
  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={`Reset password for ${user?.name}`}
      description="All of the user's sessions are signed out."
      size="sm"
      footer={
        <Button
          variant="primary"
          loading={m.resetPassword.isPending}
          onClick={() =>
            m.resetPassword.mutate(
              { id: user!.id, password },
              { onSuccess: () => (toast.success('Password reset'), setPassword(''), onClose()), onError: (e) => toast.error(errorMessage(e)) },
            )
          }
        >
          Reset password
        </Button>
      }
    >
      <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
    </Modal>
  );
}

export function AdminUsers() {
  const users = useAdminUsers();
  const me = useMe();
  const m = useAdminMutations();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserDTO | null>(null);

  const list = useMemo(() => {
    const q = query.toLowerCase();
    return (users.data ?? []).filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));
  }, [users.data, query]);

  if (users.isPending) return <PageLoader />;
  const fail = (e: unknown) => toast.error(errorMessage(e));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle" />
          <Input placeholder="Search users" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" aria-label="Search users" />
        </div>
        <Button variant="primary" icon={Plus} className="ml-auto" onClick={() => setCreating(true)}>
          Create user
        </Button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-line text-xs text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Last sign-in</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((u) => {
              const self = u.id === me.data?.id;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} size="sm" />
                      <div className="min-w-0">
                        <div className="font-medium">
                          {u.name} {self && <span className="text-xs text-subtle">(you)</span>}
                        </div>
                        <div className="text-xs text-muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">{u.role === 'admin' ? <Badge tone="accent">Admin</Badge> : <Badge>User</Badge>}</td>
                  <td className="px-4 py-2.5">
                    {u.status === 'disabled' ? <Badge tone="danger">Disabled</Badge> : u.lockedUntil ? <Badge tone="warning">Locked</Badge> : <Badge tone="success">Active</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{timeAgo(u.lastLoginAt)}</td>
                  <td className="px-4 py-2.5 text-muted">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Menu
                      trigger={(props) => <IconButton icon={Ellipsis} label={`Actions for ${u.name}`} {...props} />}
                      items={[
                        u.role === 'admin'
                          ? { label: 'Remove admin role', icon: ShieldOff, disabled: self, onSelect: () => m.updateUser.mutate({ id: u.id, input: { role: 'user' } }, { onError: fail }) }
                          : { label: 'Make administrator', icon: Shield, onSelect: () => m.updateUser.mutate({ id: u.id, input: { role: 'admin' } }, { onError: fail }) },
                        u.status === 'active'
                          ? {
                              label: 'Disable account',
                              icon: UserX,
                              disabled: self,
                              onSelect: async () => {
                                if (await confirm({ title: `Disable ${u.name}?`, message: 'They are signed out and all their access tokens are revoked.', danger: true, confirmLabel: 'Disable' })) {
                                  m.updateUser.mutate({ id: u.id, input: { status: 'disabled' } }, { onError: fail });
                                }
                              },
                            }
                          : { label: 'Enable account', icon: UserCheck, onSelect: () => m.updateUser.mutate({ id: u.id, input: { status: 'active' } }, { onError: fail }) },
                        ...(u.lockedUntil ? [{ label: 'Unlock', icon: LockOpen, onSelect: () => m.unlock.mutate(u.id, { onSuccess: () => toast.success('Unlocked'), onError: fail }) }] : []),
                        { label: 'Reset password', icon: KeyRound, onSelect: () => setResetting(u) },
                        {
                          label: 'Sign out everywhere',
                          icon: LogOut,
                          onSelect: () => m.revokeSessions.mutate(u.id, { onSuccess: (r) => toast.success(`${r.revoked} session(s) signed out`), onError: fail }),
                        },
                        {
                          label: 'Delete user',
                          icon: Trash,
                          danger: true,
                          disabled: self,
                          onSelect: async () => {
                            if (
                              await confirm({
                                title: `Delete ${u.name}?`,
                                message: 'Workspaces they own are transferred to you. This cannot be undone.',
                                danger: true,
                                confirmLabel: 'Delete user',
                                typeToConfirm: u.email,
                              })
                            ) {
                              m.deleteUser.mutate(u.id, { onSuccess: () => toast.success('User deleted'), onError: fail });
                            }
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}
