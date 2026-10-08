import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Laptop, Plus, Save, ShieldCheck, TriangleAlert, User, Users, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { UserDTO } from '@loop/shared';
import { RolePicker, roleSummary } from '../../components/agents/RolePicker';
import { TokenRolesDialog } from '../../components/agents/TokenRolesDialog';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Select } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { CodeBlock, Section } from '../../components/ui/misc';
import { api, ApiError, errorMessage } from '../../lib/api';
import { formatDate, timeAgo } from '../../lib/format';
import { keys, useConfig, useMe, useProjects, useRoles, useSessions, useTokenMutations, useTokens, useWorkspaces } from '../../lib/queries';

function Profile() {
  const me = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState(me.data?.name ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Profile" description={me.data?.email}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { user } = await api.patch<{ user: UserDTO }>('/account/profile', { name });
            qc.setQueryData(keys.me, user);
            toast.success('Profile saved');
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} className="min-w-64" />
        <Button type="submit" variant="primary" icon={Save} loading={busy}>
          Save
        </Button>
      </form>
    </Section>
  );
}

function Password() {
  const config = useConfig();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Password" description="Changing your password signs out all your other devices.">
      <form
        className="grid max-w-xl gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (form.newPassword !== form.confirm) return setErrors({ confirm: 'Passwords do not match' });
          setBusy(true);
          setErrors({});
          try {
            await api.post('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
            toast.success('Password changed');
            setForm({ currentPassword: '', newPassword: '', confirm: '' });
          } catch (err) {
            if (err instanceof ApiError && err.details) {
              const f = err.fieldErrors();
              setErrors({ currentPassword: f.currentPassword ?? '', newPassword: f.newPassword ?? f.password ?? '' });
            } else toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          className="sm:col-span-2"
          value={form.currentPassword}
          error={errors.currentPassword || undefined}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          error={errors.newPassword || undefined}
          hint={`At least ${config.data?.passwordMinLength ?? 12} characters`}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        />
        <Input label="Confirm" type="password" autoComplete="new-password" value={form.confirm} error={errors.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        <div>
          <Button type="submit" variant="primary" icon={ShieldCheck} loading={busy} disabled={!form.currentPassword || !form.newPassword}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Sessions() {
  const sessions = useSessions();
  const qc = useQueryClient();
  return (
    <Section title="Active sessions" description="Browsers signed in to your account.">
      <ul className="divide-y divide-line">
        {(sessions.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <Laptop className="size-4 text-subtle" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{s.userAgent ?? 'Unknown browser'}</div>
              <div className="text-xs text-muted">
                {s.ip ?? 'unknown IP'} · active {timeAgo(s.lastSeenAt)} · expires {formatDate(s.expiresAt)}
              </div>
            </div>
            {s.current ? (
              <Badge tone="success">This device</Badge>
            ) : (
              <IconButton
                icon={X}
                tone="danger"
                label="Sign out this session"
                onClick={async () => {
                  try {
                    await api.delete(`/account/sessions/${s.id}`);
                    void qc.invalidateQueries({ queryKey: keys.sessions });
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Tokens() {
  const tokens = useTokens();
  const m = useTokenMutations();
  const workspaces = useWorkspaces();
  const projects = useProjects();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', scope: '', expiresInDays: '90' });
  const [roleKeys, setRoleKeys] = useState<string[] | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; roleKeys: string[] | null } | null>(null);
  const roles = useRoles();
  const roleNames = new Map((roles.data ?? []).map((r) => [r.key, r.name]));

  return (
    <Section
      title="Access tokens"
      description="Personal access tokens let AI coding agents (Claude Code, Cursor, VS Code or any MCP client) work on your projects with your permissions. Prefer project-scoped tokens."
      actions={
        <Button variant="primary" icon={Plus} onClick={() => (setSecret(null), setRoleKeys(null), setOpen(true))}>
          New token
        </Button>
      }
    >
      <ul className="divide-y divide-line">
        {(tokens.data ?? []).map((t) => {
          const expired = new Date(t.expiresAt) < new Date();
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <KeyRound className="size-4 text-subtle" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  {t.name}
                  <code className="font-mono text-xs text-subtle">{t.prefix}…</code>
                  {t.revokedAt ? <Badge tone="danger">Revoked</Badge> : expired ? <Badge tone="warning">Expired</Badge> : <Badge tone="success">Active</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {t.projectName ? `Project: ${t.projectName}` : t.workspaceName ? `Workspace: ${t.workspaceName}` : 'All my projects'} · created {formatDate(t.createdAt)} · expires{' '}
                  {formatDate(t.expiresAt)} · last used {timeAgo(t.lastUsedAt)}
                </div>
                <div className="text-xs text-muted">Roles: {roleSummary(t.roleKeys, roleNames)}</div>
              </div>
              {!t.revokedAt && (
                <Button size="sm" variant="ghost" icon={Users} onClick={() => setEditing({ id: t.id, name: t.name, roleKeys: t.roleKeys })}>
                  Roles
                </Button>
              )}
              {!t.revokedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (await confirm({ title: 'Revoke token', message: `Agents using “${t.name}” will stop working immediately.`, danger: true, confirmLabel: 'Revoke' })) {
                      m.revoke.mutate(t.id, { onError: (e) => toast.error(errorMessage(e)) });
                    }
                  }}
                >
                  Revoke
                </Button>
              )}
            </li>
          );
        })}
        {tokens.data?.length === 0 && <li className="py-3 text-[13px] text-subtle">No tokens yet.</li>}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={secret ? 'Token created' : 'New access token'}
        footer={
          secret ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!form.name.trim() || roleKeys?.length === 0}
                loading={m.create.isPending}
                onClick={() => {
                  const [kind, id] = form.scope.split(':');
                  m.create.mutate(
                    {
                      name: form.name.trim(),
                      expiresInDays: Number(form.expiresInDays),
                      roleKeys,
                      ...(kind === 'p' ? { projectId: id } : kind === 'w' ? { workspaceId: id } : {}),
                    },
                    { onSuccess: (r) => setSecret(r.secret), onError: (e) => toast.error(errorMessage(e)) },
                  );
                }}
              >
                Create token
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-[13px] text-warning">
              <TriangleAlert className="size-4" /> Copy the token now. It will not be shown again.
            </p>
            <CodeBlock code={secret} />
          </div>
        ) : (
          <div className="space-y-4">
            <Input label="Name" placeholder="e.g. Laptop · Cursor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label="Scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} hint="Least privilege: limit the token to what the agent needs.">
              <option value="">All my projects</option>
              <optgroup label="Workspace">
                {(workspaces.data ?? []).filter((w) => w.myAccess !== 'viewer').map((w) => (
                  <option key={w.id} value={`w:${w.id}`}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Project">
                {(projects.data ?? []).filter((p) => p.myAccess !== 'viewer').map((p) => (
                  <option key={p.id} value={`p:${p.id}`}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </optgroup>
            </Select>
            <Select label="Expires in" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}>
              {[7, 30, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
            <RolePicker value={roleKeys} onChange={setRoleKeys} />
          </div>
        )}
      </Modal>

      <TokenRolesDialog token={editing} onClose={() => setEditing(null)} />
    </Section>
  );
}

export function AccountPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <User className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Account</h1>
          <p className="text-[13px] text-muted">Profile, security and access tokens</p>
        </div>
      </header>
      <Profile />
      <Tokens />
      <Password />
      <Sessions />
    </div>
  );
}
