import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Settings } from '@loop/shared';
import { Button } from '../../components/ui/Button';
import { Input, Switch } from '../../components/ui/Field';
import { PageLoader, Section } from '../../components/ui/misc';
import { errorMessage } from '../../lib/api';
import { useAdminMutations, useAdminSettings } from '../../lib/queries';

function NumberField({ label, value, onChange, min, max, hint }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: string }) {
  return <Input label={label} type="number" min={min} max={max} value={value} hint={hint} onChange={(e) => onChange(Number(e.target.value))} />;
}

export function AdminSettings() {
  const settings = useAdminSettings();
  const m = useAdminMutations();
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  if (settings.isPending || !form) return <PageLoader />;
  const set = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => setForm({ ...form, [section]: { ...form[section], ...patch } });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        m.saveSettings.mutate(form, { onSuccess: () => toast.success('Settings saved'), onError: (err) => toast.error(errorMessage(err)) });
      }}
    >
      <Section title="General">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Application name" value={form.general.appName} onChange={(e) => set('general', { appName: e.target.value })} />
          <NumberField label="Default sprint capacity (points)" min={1} max={500} value={form.general.defaultSprintCapacity} onChange={(n) => set('general', { defaultSprintCapacity: n })} />
        </div>
        <div className="mt-4 rounded-xl border border-line p-4">
          <Switch
            checked={form.general.registrationEnabled}
            onChange={(v) => set('general', { registrationEnabled: v })}
            label="Allow self-registration"
            description="Anyone who can reach this server could create an account. Keep it off unless the server is private."
          />
        </div>
      </Section>

      <Section title="Agent" description="Controls for every AI agent connected over MCP.">
        <div className="rounded-xl border border-line p-4">
          <Switch
            checked={form.agent.enabled}
            onChange={(v) => set('agent', { enabled: v })}
            label="Agent work enabled"
            description="Global kill switch. When off, get_next_work hands out no work on any project."
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <NumberField
            label="Rework limit"
            min={1}
            max={20}
            value={form.agent.maxBounces}
            onChange={(n) => set('agent', { maxBounces: n })}
            hint="Send-backs from review/QA before a human must decide"
          />
          <NumberField
            label="Claim timeout (minutes)"
            min={5}
            max={1440}
            value={form.agent.claimTimeoutMinutes}
            onChange={(n) => set('agent', { claimTimeoutMinutes: n })}
            hint="An unfinished claim is released after this time"
          />
          <NumberField
            label="Online window (minutes)"
            min={1}
            max={120}
            value={form.agent.onlineWindowMinutes}
            onChange={(n) => set('agent', { onlineWindowMinutes: n })}
            hint="Agent counts as online within this window"
          />
        </div>
      </Section>

      <Section title="Security">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Session lifetime (hours)" min={1} max={720} value={form.security.sessionTtlHours} onChange={(n) => set('security', { sessionTtlHours: n })} hint="Sliding expiration" />
          <NumberField label="Minimum password length" min={8} max={128} value={form.security.passwordMinLength} onChange={(n) => set('security', { passwordMinLength: n })} />
          <NumberField label="Max token lifetime (days)" min={1} max={365} value={form.security.tokenMaxDays} onChange={(n) => set('security', { tokenMaxDays: n })} />
          <NumberField label="Failed logins before lockout" min={3} max={20} value={form.security.maxFailedLogins} onChange={(n) => set('security', { maxFailedLogins: n })} />
          <NumberField label="Lockout duration (minutes)" min={1} max={1440} value={form.security.lockoutMinutes} onChange={(n) => set('security', { lockoutMinutes: n })} />
        </div>
      </Section>

      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" variant="primary" size="lg" icon={Save} loading={m.saveSettings.isPending} className="shadow-pop">
          Save settings
        </Button>
      </div>
    </form>
  );
}
