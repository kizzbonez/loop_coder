import { Bot, Pencil, Play, Plus, Square, Trash, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { API_AGENT_DEFAULTS, type AiProviderDTO, type ApiAgentDTO, type ProjectDTO } from '@loop/shared';
import { ApiError, errorMessage } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAdminAiProviders, useApiAgentMutations, useApiAgents, useRoles } from '../../lib/queries';
import { Badge, Chip } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { Input, Select, Switch } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Section } from '../ui/misc';
import { RolePicker } from './RolePicker';

const tokens = (n: number) => n.toLocaleString('en-US');

/** Add an API agent, or change one (it picks up changes from its next step). */
function ApiAgentModal({ projectId, agent, providers, onClose }: { projectId: string; agent: ApiAgentDTO | null; providers: AiProviderDTO[]; onClose: () => void }) {
  const m = useApiAgentMutations(projectId);
  const usable = providers.filter((p) => p.enabled || p.id === agent?.providerId);
  const [form, setForm] = useState({
    name: agent?.name ?? '',
    providerId: agent?.providerId ?? usable[0]?.id ?? '',
    model: agent?.modelChoice ?? '',
    roleKeys: agent ? agent.roleKeys : (null as string[] | null),
    dailyTokenLimit: String(agent?.dailyTokenLimit ?? API_AGENT_DEFAULTS.dailyTokenLimit),
    maxTurnsPerStep: String(agent?.maxTurnsPerStep ?? API_AGENT_DEFAULTS.maxTurnsPerStep),
    canRunCommands: agent?.canRunCommands ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const provider = providers.find((p) => p.id === form.providerId);
  const pending = m.create.isPending || m.update.isPending;
  const rolesValid = form.roleKeys === null || form.roleKeys.length > 0;

  const save = () => {
    setErrors({});
    const input = {
      name: form.name.trim(),
      providerId: form.providerId,
      model: form.model.trim(),
      roleKeys: form.roleKeys,
      dailyTokenLimit: Number.parseInt(form.dailyTokenLimit, 10),
      maxTurnsPerStep: Number.parseInt(form.maxTurnsPerStep, 10),
      canRunCommands: form.canRunCommands,
    };
    const onError = (e: unknown) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      toast.error(errorMessage(e));
    };
    const done = () => (toast.success(agent ? 'API agent saved' : `${input.name} added: press Start when you are ready`), onClose());
    if (agent) m.update.mutate({ id: agent.id, input }, { onSuccess: done, onError });
    else m.create.mutate({ projectId, ...input }, { onSuccess: done, onError });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={agent ? `Edit ${agent.name}` : 'Add an API agent'}
      description="Loop Coder runs this agent itself with the provider's model, billed by the provider per token."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={!form.name.trim() || !form.providerId || !rolesValid} onClick={save}>
            {agent ? 'Save' : 'Add agent'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={form.name} error={errors.name} maxLength={40} placeholder="Gemini builder" onChange={(e) => setForm({ ...form, name: e.target.value })} hint="Shown on the board and in the office" />
        <Select label="AI provider" value={form.providerId} error={errors.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value, model: '' })}>
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.enabled ? '' : ' (disabled)'}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-4">
        <Input
          className="font-mono"
          label="Model"
          value={form.model}
          error={errors.model}
          list="api-agent-models"
          placeholder={provider?.model ? `${provider.model} (the provider's default)` : 'Type a model name'}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
          hint={provider?.model ? 'Leave empty to use the provider’s default model.' : 'This provider has no default model: type one (Test the provider in Admin › AI providers to see its models).'}
        />
        <datalist id="api-agent-models">
          {(provider?.models ?? []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </div>
      <div className="mt-4">
        <RolePicker
          value={form.roleKeys}
          onChange={(roleKeys) => setForm({ ...form, roleKeys })}
          hint="For example, a Gemini agent that builds and a Claude Code session that reviews and tests. Only a Project Manager runs the kickoff, planning and sprint reviews."
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Input
          label="Daily token limit"
          type="number"
          min={10_000}
          step={100_000}
          value={form.dailyTokenLimit}
          error={errors.dailyTokenLimit}
          onChange={(e) => setForm({ ...form, dailyTokenLimit: e.target.value })}
          hint="Input and output tokens per day (UTC). When it is spent, the agent waits until tomorrow."
        />
        <Input
          label="Tool rounds per step"
          type="number"
          min={5}
          max={200}
          value={form.maxTurnsPerStep}
          error={errors.maxTurnsPerStep}
          onChange={(e) => setForm({ ...form, maxTurnsPerStep: e.target.value })}
          hint="At most this many model calls for one work item stage or ceremony."
        />
      </div>
      <div className="mt-4 rounded-xl border border-line p-4">
        <Switch
          checked={form.canRunCommands}
          onChange={(canRunCommands) => setForm({ ...form, canRunCommands })}
          label="Can run commands"
          description="Shell commands (git, builds, tests) in its own folders, as an unprivileged user without internet access. Off: it can only read and write files."
        />
      </div>
    </Modal>
  );
}

/** Agents Loop Coder runs itself with an AI provider's API key (administrators only). */
export function ApiAgents({ project }: { project: Pick<ProjectDTO, 'id'> }) {
  const agents = useApiAgents(project.id);
  const providers = useAdminAiProviders();
  const roles = useRoles();
  const m = useApiAgentMutations(project.id);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ApiAgentDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const colours = new Map((roles.data ?? []).map((r) => [r.key, r]));
  const providerList = providers.data?.items ?? [];
  const items = agents.data?.items ?? [];
  const busy = (id: string) => (m.start.isPending && m.start.variables === id) || (m.stop.isPending && m.stop.variables === id);
  const onError = (e: unknown) => toast.error(errorMessage(e));

  return (
    <Section
      title="API agents"
      description="Agents Loop Coder runs itself with an AI provider's API key (Claude, Gemini, OpenAI, Qwen, Kimi, …), billed by the provider per token. Give each the roles it plays, then start it. Only administrators see this."
      actions={
        <Button size="sm" variant="primary" icon={Plus} disabled={!providerList.some((p) => p.enabled)} onClick={() => setCreating(true)}>
          Add API agent
        </Button>
      }
    >
      {agents.data && !agents.data.runnerConfigured && (
        <div role="alert" className="mb-4 flex gap-3 rounded-xl border border-warning/40 bg-warning/8 p-4 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            The runner is not set up yet, so API agents cannot start. On the server, in the Loop Coder folder, run <code className="font-mono">npm run secrets-key</code> (it adds{' '}
            <code className="font-mono">LOOP_RUNNER_SECRET</code> to <code className="font-mono">.env</code>), then <code className="font-mono">npm run up</code>.
          </p>
        </div>
      )}
      {providers.data && !providerList.some((p) => p.enabled) && (
        <p className="mb-3 text-[13px] text-muted">
          First add an AI provider and its API key in{' '}
          <Link to="/admin/ai-providers" className="font-medium text-accent hover:underline">
            Admin › AI providers
          </Link>
          .
        </p>
      )}
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-subtle">
          <Bot className="size-4" /> No API agents on this project yet.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => {
            const used = a.usageToday.inputTokens + a.usageToday.outputTokens;
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-medium">{a.name}</span>
                    <Badge tone={a.state === 'running' ? 'success' : 'neutral'}>{a.state === 'running' ? 'Running' : 'Stopped'}</Badge>
                    <span className="text-xs text-muted">
                      {a.providerName ?? 'no provider'} · <span className="font-mono">{a.model || 'no model'}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Roles of ${a.name}`}>
                    {a.roleKeys === null ? (
                      <Badge>Every role</Badge>
                    ) : (
                      a.roleKeys.map((k) => (
                        <Chip key={k} color={colours.get(k)?.color ?? '#8b8b8b'} dot>
                          {colours.get(k)?.name ?? k}
                        </Chip>
                      ))
                    )}
                  </div>
                  {(a.status.activity || a.status.error) && (
                    <p className="mt-1.5 text-xs text-muted">
                      {a.status.activity}
                      {a.status.at ? ` · ${timeAgo(a.status.at)}` : ''}
                    </p>
                  )}
                  {a.status.error && <p className="mt-1 text-xs text-danger">{a.status.error}</p>}
                  <p className="mt-1 text-xs text-subtle">
                    Today: {tokens(used)} of {tokens(a.dailyTokenLimit)} tokens · {tokens(a.usageToday.requests)} requests{a.canRunCommands ? '' : ' · no commands'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {a.state === 'running' ? (
                    <Button size="sm" variant="outline" icon={Square} loading={busy(a.id)} aria-label={`Stop ${a.name}`} onClick={() => m.stop.mutate(a.id, { onError })}>
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Play}
                      loading={busy(a.id)}
                      disabled={agents.data?.runnerConfigured === false}
                      aria-label={`Start ${a.name}`}
                      onClick={() => m.start.mutate(a.id, { onError })}
                    >
                      Start
                    </Button>
                  )}
                  <IconButton icon={Pencil} label={`Edit ${a.name}`} onClick={() => setEditing(a)} />
                  <IconButton
                    icon={Trash}
                    tone="danger"
                    label={`Delete ${a.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Delete ${a.name}?`, message: 'It stops, and its access token is revoked. Its work on the board stays.', danger: true, confirmLabel: 'Delete' })) {
                        m.remove.mutate(a.id, { onError });
                      }
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <ApiAgentModal projectId={project.id} agent={null} providers={providerList} onClose={() => setCreating(false)} />}
      {editing && <ApiAgentModal key={editing.id} projectId={project.id} agent={editing} providers={providerList} onClose={() => setEditing(null)} />}
    </Section>
  );
}
