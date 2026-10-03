import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, KeyRound, Rocket, ShieldCheck, Sparkles, Terminal } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { UserDTO } from '@loop/shared';
import { Button } from '../../components/ui/Button';
import { Input, Switch } from '../../components/ui/Field';
import { CodeBlock } from '../../components/ui/misc';
import { api, ApiError, errorMessage } from '../../lib/api';
import { keys, useConfig } from '../../lib/queries';
import { AuthLayout } from './AuthLayout';

const STEPS = ['Welcome', 'Verify', 'Administrator', 'Workspace', 'Done'] as const;

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2" aria-label="Setup progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={clsx(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition',
              i < step ? 'brand-gradient text-white' : i === step ? 'border-2 border-accent text-accent' : 'border border-line-strong text-subtle',
            )}
            aria-current={i === step ? 'step' : undefined}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={clsx('hidden text-xs sm:inline', i === step ? 'font-medium text-fg' : 'text-subtle')}>{label}</span>
          {i < STEPS.length - 1 && <span className={clsx('h-px flex-1', i < step ? 'bg-accent' : 'bg-line-strong')} />}
        </li>
      ))}
    </ol>
  );
}

/** First-run onboarding: verifies the one-time setup code, creates the administrator and the first workspace. */
export function SetupWizard() {
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    setupCode: '',
    name: '',
    email: '',
    password: '',
    confirm: '',
    appName: 'Loop Coder',
    workspaceName: '',
    registrationEnabled: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minLength = config.data?.passwordMinLength ?? 12;

  // Setup already done (and not just finished in this wizard): nothing to do here.
  if (config.data && !config.data.setupRequired && step !== 4) return <Navigate to="/" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const validateAdmin = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Enter your name';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'Enter a valid email address';
    if (form.password.length < minLength) e.password = `Use at least ${minLength} characters`;
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.workspaceName.trim()) {
      setErrors({ workspaceName: 'Name your first workspace' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { confirm: _confirm, ...body } = form;
      const res = await api.post<{ user: UserDTO; workspaceId: string }>('/setup', body);
      qc.setQueryData(keys.me, res.user);
      await qc.invalidateQueries({ queryKey: keys.config });
      setStep(4);
      setForm((f) => ({ ...f, password: '', confirm: '' }));
      sessionStorage.setItem('lc-setup-workspace', res.workspaceId);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setStep(1);
        else if (err.fieldErrors().password || err.fieldErrors().email) setStep(2);
        setErrors(err.fieldErrors());
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout wide>
      <Stepper step={step} />

      {step === 0 && (
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
            <Sparkles className="size-3.5" /> First-time setup
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">Welcome to Loop Coder</h2>
          <p className="mt-2 text-sm text-muted">
            In three short steps you will create the administrator account and your first workspace. After that you can create
            projects and connect an AI coding agent (Claude Code, Cursor, VS Code…) to work the board.
          </p>
          <Button variant="primary" size="lg" className="mt-8" icon={ArrowRight} onClick={() => setStep(1)}>
            Get started
          </Button>
        </div>
      )}

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.setupCode.trim()) setErrors({ setupCode: 'Enter the setup code' });
            else {
              setErrors({});
              setStep(2);
            }
          }}
        >
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck className="size-5 text-accent" /> Verify that you own this server
          </h2>
          <p className="mt-2 text-sm text-muted">
            For security, the first administrator must enter the one-time setup code printed in the server logs. Run:
          </p>
          <CodeBlock className="mt-3" code="docker compose logs api | grep -i 'setup code'" />
          <p className="mt-2 text-xs text-subtle">On Windows PowerShell: docker compose logs api | Select-String "setup code"</p>
          <Input
            className="mt-5 font-mono tracking-widest uppercase"
            label="Setup code"
            placeholder="XXXX-XXXX-XXXX"
            value={form.setupCode}
            onChange={set('setupCode')}
            error={errors.setupCode}
            autoComplete="off"
            autoFocus
          />
          {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(0)}>
              Back
            </Button>
            <Button type="submit" variant="primary" icon={ArrowRight}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (validateAdmin()) setStep(3);
          }}
          noValidate
        >
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <KeyRound className="size-5 text-accent" /> Create the administrator
          </h2>
          <p className="mt-2 text-sm text-muted">This account manages users, roles, settings and security.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="name" autoFocus />
            <Input label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
            <Input
              label="Password"
              type="password"
              value={form.password}
              onChange={set('password')}
              error={errors.password}
              autoComplete="new-password"
              hint={`At least ${minLength} characters`}
            />
            <Input label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" />
          </div>
          {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="submit" variant="primary" icon={ArrowRight}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={finish} noValidate>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Rocket className="size-5 text-accent" /> Your workspace
          </h2>
          <p className="mt-2 text-sm text-muted">Workspaces hold projects and the people who work on them. You can create more later.</p>
          <div className="mt-6 space-y-4">
            <Input
              label="Workspace name"
              placeholder="e.g. Acme Engineering"
              value={form.workspaceName}
              onChange={set('workspaceName')}
              error={errors.workspaceName}
              autoFocus
            />
            <Input label="Application name" value={form.appName} onChange={set('appName')} hint="Shown in the browser title and sign-in page." />
            <div className="rounded-xl border border-line p-4">
              <Switch
                checked={form.registrationEnabled}
                onChange={(v) => setForm({ ...form, registrationEnabled: v })}
                label="Allow self-registration"
                description="When off (recommended), only administrators can create accounts."
              />
            </div>
          </div>
          {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(2)}>
              Back
            </Button>
            <Button type="submit" variant="primary" icon={Check} loading={busy}>
              Finish setup
            </Button>
          </div>
        </form>
      )}

      {step === 4 && (
        <div>
          <div className="brand-gradient flex size-12 items-center justify-center rounded-2xl text-white">
            <Check className="size-6" />
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">You are all set</h2>
          <p className="mt-2 text-sm text-muted">Next steps:</p>
          <ol className="mt-4 space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="font-semibold text-accent">1.</span> Create a project and describe its goal.
            </li>
            <li className="flex gap-3">
              <span className="font-semibold text-accent">2.</span>
              <span>
                Open the project's <b>Agent</b> tab to create an access token and connect your coding agent <Terminal className="inline size-3.5" />.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-semibold text-accent">3.</span> Start the work loop and watch the board update live.
            </li>
          </ol>
          <Button
            variant="primary"
            size="lg"
            className="mt-8"
            icon={ArrowRight}
            onClick={() => navigate(`/w/${sessionStorage.getItem('lc-setup-workspace') ?? ''}`, { replace: true })}
          >
            Open my workspace
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
