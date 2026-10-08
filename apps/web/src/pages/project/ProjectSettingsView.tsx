import { Save, Trash } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDTO, GitMode, RoleSource } from '@loop/shared';
import { Button } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Section } from '../../components/ui/misc';
import { ApiError, errorMessage } from '../../lib/api';
import { useDeleteProject, useUpdateColumn, useUpdateProject } from '../../lib/queries';
import { useProjectContext } from './context';

function ColumnRow({ column }: { column: ColumnDTO }) {
  const { project, roles } = useProjectContext();
  const update = useUpdateColumn(project.id);
  const [form, setForm] = useState({
    name: column.name,
    color: column.color ?? '#64748b',
    agentRoleId: column.agentRoleId ?? '',
    roleSource: column.roleSource,
    wipLimit: column.wipLimit?.toString() ?? '',
  });
  const humanOnly = column.kind === 'done' || column.kind === 'blocked';
  const dirty =
    form.name !== column.name ||
    form.color !== (column.color ?? '#64748b') ||
    form.agentRoleId !== (column.agentRoleId ?? '') ||
    form.roleSource !== column.roleSource ||
    form.wipLimit !== (column.wipLimit?.toString() ?? '');

  return (
    <tr className="align-middle">
      <td className="py-2 pr-2">
        <input
          type="color"
          value={form.color}
          onChange={(e) => setForm({ ...form, color: e.target.value })}
          className="size-8 cursor-pointer rounded-md border border-line bg-transparent"
          aria-label={`${column.name} colour`}
        />
      </td>
      <td className="py-2 pr-2">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Column name" className="min-w-32" />
        <div className="mt-1 font-mono text-[10px] text-subtle">{column.kind}</div>
      </td>
      <td className="py-2 pr-2">
        <Select
          value={form.agentRoleId}
          disabled={humanOnly}
          onChange={(e) => setForm({ ...form, agentRoleId: e.target.value })}
          aria-label="Agent role"
          className="min-w-40"
        >
          <option value="">{humanOnly ? 'Humans' : 'No agent'}</option>
          {roles
            .filter((r) => r.enabled)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>
      </td>
      <td className="py-2 pr-2">
        <Select
          value={form.roleSource}
          disabled={humanOnly}
          onChange={(e) => setForm({ ...form, roleSource: e.target.value as RoleSource })}
          aria-label="Role source"
          className="min-w-36"
        >
          <option value="column">Column role</option>
          <option value="task">Item's assigned role</option>
        </Select>
      </td>
      <td className="py-2 pr-2">
        <Input
          type="number"
          min={1}
          max={100}
          placeholder="∞"
          value={form.wipLimit}
          onChange={(e) => setForm({ ...form, wipLimit: e.target.value })}
          aria-label="WIP limit"
          className="w-20"
        />
      </td>
      <td className="py-2 text-right">
        <Button
          size="sm"
          variant={dirty ? 'primary' : 'ghost'}
          disabled={!dirty}
          loading={update.isPending}
          onClick={() =>
            update.mutate(
              {
                columnId: column.id,
                input: {
                  name: form.name.trim(),
                  color: form.color,
                  agentRoleId: humanOnly ? null : form.agentRoleId || null,
                  roleSource: form.roleSource,
                  wipLimit: form.wipLimit ? Number(form.wipLimit) : null,
                },
              },
              { onSuccess: () => toast.success(`Column “${form.name}” saved`), onError: (e) => toast.error(errorMessage(e)) },
            )
          }
        >
          Save
        </Button>
      </td>
    </tr>
  );
}

export function ProjectSettingsView() {
  const { project, isOwner } = useProjectContext();
  const update = useUpdateProject(project.id);
  const remove = useDeleteProject();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [general, setGeneral] = useState({ name: project.name, description: project.description, sprintCapacity: String(project.sprintCapacity) });
  const [agile, setAgile] = useState({ definitionOfReady: project.definitionOfReady, definitionOfDone: project.definitionOfDone });
  const [notes, setNotes] = useState(project.notes);
  const [git, setGit] = useState<{ gitMode: GitMode; baseBranch: string }>({ gitMode: project.gitMode, baseBranch: project.baseBranch });
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!isOwner) return <Navigate to={`/p/${project.id}/board`} replace />;

  const save = (input: Parameters<typeof update.mutate>[0], what: string) => {
    setErrors({});
    update.mutate(input, {
      onSuccess: () => toast.success(`${what} saved`),
      onError: (e) => {
        if (e instanceof ApiError) setErrors(e.fieldErrors());
        toast.error(errorMessage(e));
      },
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Section title="General">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <Input label="Name" value={general.name} error={errors.name} onChange={(e) => setGeneral({ ...general, name: e.target.value })} />
            <Input
              label="Sprint capacity (points)"
              type="number"
              min={1}
              max={500}
              value={general.sprintCapacity}
              error={errors.sprintCapacity}
              onChange={(e) => setGeneral({ ...general, sprintCapacity: e.target.value })}
            />
          </div>
          <Textarea label="Goal and requirements" rows={8} value={general.description} onChange={(e) => setGeneral({ ...general, description: e.target.value })} hint="The agent reads this during the kickoff and planning." />
          <Button
            variant="primary"
            icon={Save}
            loading={update.isPending}
            onClick={() => save({ name: general.name.trim(), description: general.description, sprintCapacity: Number(general.sprintCapacity) }, 'Project')}
          >
            Save
          </Button>
        </div>
      </Section>

      <Section title="Agile agreements" description="Every role checks these. The Definition of Ready gates sprint planning; the Definition of Done gates QA.">
        <div className="grid gap-4 md:grid-cols-2">
          <Textarea label="Definition of Ready" rows={8} value={agile.definitionOfReady} onChange={(e) => setAgile({ ...agile, definitionOfReady: e.target.value })} />
          <Textarea label="Definition of Done" rows={8} value={agile.definitionOfDone} onChange={(e) => setAgile({ ...agile, definitionOfDone: e.target.value })} />
        </div>
        <Button variant="primary" icon={Save} className="mt-4" loading={update.isPending} onClick={() => save(agile, 'Agreements')}>
          Save agreements
        </Button>
      </Section>

      <Section title="Project notes" description="Shared memory: the agent records decisions, conventions and lessons here and reads them at every step.">
        <Textarea rows={12} value={notes} onChange={(e) => setNotes(e.target.value)} className="font-mono text-[13px]" />
        <Button variant="primary" icon={Save} className="mt-4" loading={update.isPending} onClick={() => save({ notes }, 'Notes')}>
          Save notes
        </Button>
      </Section>

      <Section
        title="Git"
        description="How agents share the code. With a worktree per agent, several agents can work at once without touching each other's files: each item gets its own branch, merged into the base branch when it is done."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
            <Select label="Working copies" value={git.gitMode} onChange={(e) => setGit({ ...git, gitMode: e.target.value as GitMode })}>
              <option value="worktrees">A git worktree per agent, a branch per item</option>
              <option value="shared">One shared project folder</option>
            </Select>
            <Input
              label="Base branch"
              value={git.baseBranch}
              error={errors.baseBranch}
              onChange={(e) => setGit({ ...git, baseBranch: e.target.value })}
              hint="Finished items are merged into it"
            />
          </div>
          {git.gitMode === 'worktrees' && (
            <p className="text-xs text-muted">
              Each agent works in <code className="font-mono">{project.workspacePath}.worktrees/&lt;agent&gt;</code> on <code className="font-mono">item/{project.key}-&lt;n&gt;</code>. The project folder keeps only
              finished work, so the Files tab shows what has been merged.
            </p>
          )}
          <Button variant="primary" icon={Save} loading={update.isPending} onClick={() => save({ gitMode: git.gitMode, baseBranch: git.baseBranch.trim() }, 'Git settings')}>
            Save
          </Button>
        </div>
      </Section>

      <Section title="Board columns" description="Rename stages, set WIP limits and choose which agent role works in each stage.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-subtle">
              <tr>
                <th className="pb-2 font-medium">Colour</th>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Agent role</th>
                <th className="pb-2 font-medium">Role comes from</th>
                <th className="pb-2 font-medium">WIP limit</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {project.columns.map((c) => (
                <ColumnRow key={c.id} column={c} />
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <section className="rounded-xl border border-danger/40 p-5">
        <h2 className="text-[15px] font-semibold text-danger">Danger zone</h2>
        <p className="mt-1 text-[13px] text-muted">Deleting the project removes its board, sprints, remarks and history. The code folder on disk is not touched.</p>
        <Button
          variant="danger"
          icon={Trash}
          className="mt-4"
          onClick={async () => {
            if (await confirm({ title: `Delete ${project.name}?`, message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete project', typeToConfirm: project.key })) {
              remove.mutate(project.id, {
                onSuccess: () => {
                  toast.success('Project deleted');
                  navigate(`/w/${project.workspaceId}`, { replace: true });
                },
                onError: (e) => toast.error(errorMessage(e)),
              });
            }
          }}
        >
          Delete project
        </Button>
      </section>
    </div>
  );
}
