import { Save, Trash } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Textarea } from '../../components/ui/Field';
import { Section } from '../../components/ui/misc';
import { ApiError, errorMessage } from '../../lib/api';
import { useDeleteWorkspace, useUpdateWorkspace } from '../../lib/queries';
import { useWorkspaceOutlet } from './WorkspaceLayout';

export function WorkspaceSettings() {
  const { workspace } = useWorkspaceOutlet();
  const update = useUpdateWorkspace(workspace.id);
  const remove = useDeleteWorkspace();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: workspace.name, slug: workspace.slug, description: workspace.description });
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (workspace.myAccess !== 'owner' && workspace.myAccess !== 'admin') return <Navigate to={`/w/${workspace.id}`} replace />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Section title="General">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            update.mutate(form, {
              onSuccess: () => toast.success('Workspace saved'),
              onError: (err) => {
                if (err instanceof ApiError) setErrors(err.fieldErrors());
                toast.error(errorMessage(err));
              },
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input
              label="URL slug"
              value={form.slug}
              error={errors.slug}
              className="font-mono"
              hint="Also the folder name for project code: workspaces/<slug>/<project>"
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
            />
          </div>
          <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Button type="submit" variant="primary" icon={Save} loading={update.isPending}>
            Save changes
          </Button>
        </form>
      </Section>

      <section className="rounded-xl border border-danger/40 p-5">
        <h2 className="text-[15px] font-semibold text-danger">Danger zone</h2>
        <p className="mt-1 text-[13px] text-muted">
          Deleting the workspace permanently removes all {workspace.projectCount} projects, boards, sprints and history. Code folders on disk are not touched.
        </p>
        <Button
          variant="danger"
          icon={Trash}
          className="mt-4"
          onClick={async () => {
            const ok = await confirm({
              title: 'Delete workspace',
              message: 'This cannot be undone.',
              danger: true,
              confirmLabel: 'Delete forever',
              typeToConfirm: workspace.name,
            });
            if (ok) {
              remove.mutate(workspace.id, {
                onSuccess: () => {
                  toast.success('Workspace deleted');
                  navigate('/', { replace: true });
                },
                onError: (err) => toast.error(errorMessage(err)),
              });
            }
          }}
        >
          Delete workspace
        </Button>
      </section>
    </div>
  );
}
