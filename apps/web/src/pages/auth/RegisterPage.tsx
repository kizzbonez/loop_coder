import { useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import type { UserDTO } from '@loop/shared';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { api, ApiError, errorMessage } from '../../lib/api';
import { keys, useConfig, useMe } from '../../lib/queries';
import { AuthLayout } from './AuthLayout';

export function RegisterPage() {
  const me = useMe();
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to="/" replace />;
  if (config.data && !config.data.registrationEnabled) {
    return (
      <AuthLayout>
        <h2 className="text-2xl font-semibold">Registration is closed</h2>
        <p className="mt-2 text-sm text-muted">Ask an administrator to create an account for you.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const { user } = await api.post<{ user: UserDTO }>('/auth/register', form);
      qc.setQueryData(keys.me, user);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.fieldErrors());
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
      <form className="mt-8 space-y-4" onSubmit={submit} noValidate>
        <Input label="Name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} autoFocus />
        <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint={`At least ${config.data?.passwordMinLength ?? 12} characters. A passphrase works well.`}
        />
        {error && !Object.keys(errors).length && <p className="text-[13px] text-danger">{error}</p>}
        <Button type="submit" variant="primary" size="lg" icon={UserPlus} loading={busy} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
