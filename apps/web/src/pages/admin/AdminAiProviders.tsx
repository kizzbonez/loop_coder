import { Cpu, KeyRound, Pencil, PlugZap, Plus, ShieldCheck, Trash, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AI_PROVIDER_PRESETS, aiProviderPreset, type AiProviderDTO, type AiProviderPresetId } from '@loop/shared';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Confirm';
import { Input, Select, Switch } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, PageLoader } from '../../components/ui/misc';
import { ApiError, errorMessage } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAdminAiProviders, useAiProviderMutations } from '../../lib/queries';

/** Add a provider, or edit one (the stored key is kept unless a new one is typed). */
function ProviderModal({ provider, onClose }: { provider: AiProviderDTO | null; onClose: () => void }) {
  const m = useAiProviderMutations();
  const first = AI_PROVIDER_PRESETS[0];
  const [form, setForm] = useState({
    preset: provider?.preset ?? first.id,
    name: provider?.name ?? first.label,
    baseUrl: provider?.baseUrl ?? first.baseUrl,
    model: provider?.model ?? first.defaultModel,
    apiKey: '',
    enabled: provider?.enabled ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preset = aiProviderPreset(form.preset);
  const pending = m.create.isPending || m.update.isPending;
  const onError = (e: unknown) => {
    if (e instanceof ApiError) setErrors(e.fieldErrors());
    toast.error(errorMessage(e));
  };
  const choosePreset = (id: string) => {
    const next = aiProviderPreset(id)!;
    setForm({ ...form, preset: id, name: form.name === preset?.label || !form.name ? next.label : form.name, baseUrl: next.baseUrl, model: next.defaultModel });
  };
  const save = () => {
    setErrors({});
    if (provider) {
      m.update.mutate(
        {
          id: provider.id,
          input: {
            name: form.name.trim(),
            baseUrl: form.baseUrl.trim(),
            model: form.model.trim(),
            enabled: form.enabled,
            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          },
        },
        { onSuccess: () => (toast.success('Provider saved'), onClose()), onError },
      );
    } else {
      m.create.mutate(
        { preset: form.preset as AiProviderPresetId, name: form.name.trim(), baseUrl: form.baseUrl.trim() || undefined, model: form.model.trim(), apiKey: form.apiKey.trim(), enabled: form.enabled },
        {
          onSuccess: (created) => {
            onClose();
            // Check the key straight away, so a typo shows up now rather than when an agent runs.
            m.test.mutate(created.id, {
              onSuccess: (r) => (r.ok ? toast.success(`${created.name}: ${r.message}`) : toast.error(`${created.name}: ${r.message}`)),
              onError: (e) => toast.error(errorMessage(e)),
            });
          },
          onError,
        },
      );
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={provider ? `Edit ${provider.name}` : 'Add an AI provider'}
      description="The API key is encrypted on the server. After saving, only its last four characters are ever shown."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={!provider && !form.apiKey.trim()} onClick={save}>
            {provider ? 'Save' : 'Add and test'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Provider" value={form.preset} disabled={Boolean(provider)} onChange={(e) => choosePreset(e.target.value)}>
          {AI_PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        <Input label="Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} hint="How agents and admins see it" />
      </div>
      <div className="mt-4">
        <Input
          className="font-mono"
          label="Base URL"
          value={form.baseUrl}
          error={errors.baseUrl}
          placeholder="https://"
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          hint={preset?.kind === 'anthropic' ? 'Called with the official Anthropic SDK.' : 'An OpenAI-compatible API (it lists models at /models). Change it for another region if your provider has one.'}
        />
      </div>
      <div className="mt-4">
        <Input
          className="font-mono"
          label="API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={form.apiKey}
          error={errors.apiKey}
          placeholder={provider ? `Leave empty to keep the saved key${provider.key.hint ? ` (…${provider.key.hint})` : ''}` : preset?.keyPlaceholder}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
      </div>
      <div className="mt-4">
        <Input
          className="font-mono"
          label="Default model"
          value={form.model}
          error={errors.model}
          list="provider-models"
          onChange={(e) => setForm({ ...form, model: e.target.value })}
          hint={provider?.models.length ? `${provider.models.length} models from the last test are suggested.` : 'Test the connection to see the models this key can use.'}
        />
      </div>
      <datalist id="provider-models">
        {(provider?.models ?? []).map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <div className="mt-4 rounded-xl border border-line p-4">
        <Switch checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label="Enabled" description="Only enabled providers can be used, and only their hosts are reachable from the server." />
      </div>
    </Modal>
  );
}

export function AdminAiProviders() {
  const providers = useAdminAiProviders();
  const m = useAiProviderMutations();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AiProviderDTO | null>(null);
  const [creating, setCreating] = useState(false);
  if (providers.isPending) return <PageLoader />;
  const data = providers.data;
  const items = data?.items ?? [];
  const testing = m.test.isPending ? m.test.variables : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-3xl text-[13px] text-muted">
          API keys for the AI models agents can use: Anthropic (Claude), OpenAI, Gemini, Qwen, Kimi, DeepSeek, OpenRouter or any OpenAI-compatible service. Keys are encrypted with the
          server's <code className="font-mono">LOOP_SECRETS_KEY</code> and never shown again; the server can reach only the hosts of enabled providers.
        </p>
        <Button variant="primary" icon={Plus} className="ml-auto" disabled={!data?.secretsConfigured} onClick={() => setCreating(true)}>
          Add provider
        </Button>
      </div>

      {data && !data.secretsConfigured && (
        <div role="alert" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/8 p-4 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">Secret storage is not set up yet, so API keys cannot be saved.</p>
            <p className="mt-1 text-muted">
              On the server, in the Loop Coder folder, run <code className="font-mono">npm run secrets-key</code> (it adds a random <code className="font-mono">LOOP_SECRETS_KEY</code> to{' '}
              <code className="font-mono">.env</code> without showing it), then restart with <code className="font-mono">npm run up</code>. Back the key up together with your database
              backups: without it, saved keys cannot be read.
            </p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={Cpu} title="No AI providers yet" description="Add a provider and its API key. Agents that use the API instead of a subscription will use them." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-subtle">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">Provider</th>
                <th className="px-4 py-2.5 font-medium">Default model</th>
                <th className="px-4 py-2.5 font-medium">Key</th>
                <th className="px-4 py-2.5 font-medium">Last test</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      {p.name}
                      {!p.enabled && <Badge tone="warning">Disabled</Badge>}
                    </div>
                    <div className="text-xs text-muted">{aiProviderPreset(p.preset)?.label ?? p.preset}</div>
                    <div className="font-mono text-[11px] text-subtle">{new URL(p.baseUrl).hostname}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.model || <span className="text-subtle">not chosen</span>}</td>
                  <td className="px-4 py-3">
                    {p.key.status === 'ok' ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                        <KeyRound className="size-3.5 text-subtle" />…{p.key.hint ?? '••••'}
                      </span>
                    ) : (
                      <Badge tone="danger">Locked: enter the key again</Badge>
                    )}
                  </td>
                  <td className="max-w-72 px-4 py-3">
                    {p.lastTest ? (
                      <>
                        <Badge tone={p.lastTest.ok ? 'success' : 'danger'}>{p.lastTest.ok ? 'Connected' : 'Failed'}</Badge>
                        <p className="mt-1 text-xs text-muted">
                          {p.lastTest.message} · {timeAgo(p.lastTest.at)}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-subtle">Not tested</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        icon={PlugZap}
                        loading={testing === p.id}
                        disabled={p.key.status !== 'ok'}
                        aria-label={`Test ${p.name}`}
                        onClick={() =>
                          m.test.mutate(p.id, {
                            onSuccess: (r) => (r.ok ? toast.success(`${p.name}: ${r.message}`) : toast.error(`${p.name}: ${r.message}`)),
                            onError: (e) => toast.error(errorMessage(e)),
                          })
                        }
                      >
                        Test
                      </Button>
                      <IconButton icon={Pencil} label={`Edit ${p.name}`} onClick={() => setEditing(p)} />
                      <IconButton
                        icon={Trash}
                        tone="danger"
                        label={`Delete ${p.name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Delete ${p.name}?`, message: 'Its encrypted key is deleted too, and the server can no longer reach this provider.', danger: true, confirmLabel: 'Delete' })) {
                            m.remove.mutate(p.id, { onError: (e) => toast.error(errorMessage(e)) });
                          }
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-muted">
        <ShieldCheck className="size-4 text-success" />
        The server can reach: {data?.allowedHosts.length ? data.allowedHosts.join(', ') : 'nothing (no enabled providers)'}.
      </p>

      {creating && <ProviderModal provider={null} onClose={() => setCreating(false)} />}
      {editing && <ProviderModal key={editing.id} provider={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
