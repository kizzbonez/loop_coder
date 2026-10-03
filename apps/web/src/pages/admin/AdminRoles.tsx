import { Lock, Pencil, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { AgentRoleDTO } from '@loop/shared';
import { Badge, Chip } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Switch, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { PageLoader } from '../../components/ui/misc';
import { ApiError, errorMessage } from '../../lib/api';
import { useAdminMutations, useAdminRoles } from '../../lib/queries';

const EMPTY = { key: '', name: '', description: '', instructions: '', color: '#6366f1', enabled: true, assignable: true };

function RoleModal({ role, open, onClose }: { role: AgentRoleDTO | null; open: boolean; onClose: () => void }) {
  const m = useAdminMutations();
  const [form, setForm] = useState(role ? { ...role } : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = m.createRole.isPending || m.updateRole.isPending;
  const onError = (e: unknown) => {
    if (e instanceof ApiError) setErrors(e.fieldErrors());
    toast.error(errorMessage(e));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={role ? `Edit ${role.name}` : 'New agent role'}
      description="The instructions are what the agent follows when it plays this role. Be specific about responsibilities, quality bar and outputs."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              const { key, name, description, instructions, color, enabled, assignable } = form;
              if (role) m.updateRole.mutate({ id: role.id, input: { name, description, instructions, color, enabled, assignable } }, { onSuccess: () => (toast.success('Role saved'), onClose()), onError });
              else m.createRole.mutate({ key, name, description, instructions, color, enabled, assignable }, { onSuccess: () => (toast.success('Role created'), onClose()), onError });
            }}
          >
            Save role
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_6rem]">
        <Input label="Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input
          label="Key"
          value={form.key}
          error={errors.key}
          disabled={Boolean(role)}
          className="font-mono"
          hint="Used by the agent (assigned_role), e.g. data_engineer"
          onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Colour</span>
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 w-full cursor-pointer rounded-lg border border-line bg-transparent" aria-label="Colour" />
        </div>
      </div>
      <Input className="mt-4" label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <Textarea
        className="mt-4 font-mono text-[12.5px]"
        label="Instructions"
        rows={16}
        value={form.instructions}
        error={errors.instructions}
        onChange={(e) => setForm({ ...form, instructions: e.target.value })}
      />
      <div className="mt-4 grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-2">
        <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Enabled" description="Disabled roles are never handed work." />
        <Switch checked={form.assignable} onChange={(v) => setForm({ ...form, assignable: v })} label="Assignable to items" description="Can be chosen as an item's implementation role." />
      </div>
    </Modal>
  );
}

export function AdminRoles() {
  const roles = useAdminRoles();
  const m = useAdminMutations();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AgentRoleDTO | null>(null);
  const [creating, setCreating] = useState(false);
  if (roles.isPending) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-[13px] text-muted">
          One AI agent plays every role. Built-in roles cover the SDLC; add your own (for example a Data Engineer) and map them to board columns or assign them to items.
        </p>
        <Button variant="primary" icon={Plus} className="ml-auto" onClick={() => setCreating(true)}>
          New role
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(roles.data ?? []).map((r) => (
          <article key={r.id} className="card flex flex-col p-4">
            <div className="flex items-center gap-2">
              <Chip color={r.color} dot>
                {r.name}
              </Chip>
              <code className="font-mono text-[11px] text-subtle">{r.key}</code>
              {r.isSystem && (
                <span title="Built-in role" className="text-subtle">
                  <Lock className="size-3.5" />
                </span>
              )}
              {!r.enabled && <Badge tone="warning">Disabled</Badge>}
              <span className="ml-auto flex">
                <IconButton icon={Pencil} label={`Edit ${r.name}`} onClick={() => setEditing(r)} />
                {!r.isSystem && (
                  <IconButton
                    icon={Trash}
                    tone="danger"
                    label={`Delete ${r.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Delete ${r.name}?`, message: 'Items assigned to this role fall back to the column role.', danger: true, confirmLabel: 'Delete' })) {
                        m.deleteRole.mutate(r.id, { onError: (e) => toast.error(errorMessage(e)) });
                      }
                    }}
                  />
                )}
              </span>
            </div>
            <p className="mt-2 text-[13px] text-muted">{r.description}</p>
            <pre className="mt-3 line-clamp-6 rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] whitespace-pre-wrap text-muted">{r.instructions}</pre>
          </article>
        ))}
      </div>
      {creating && <RoleModal role={null} open onClose={() => setCreating(false)} />}
      {editing && <RoleModal key={editing.id} role={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}
