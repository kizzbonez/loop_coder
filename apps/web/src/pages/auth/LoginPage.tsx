import { useQueryClient } from '@tanstack/react-query';
import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import type { UserDTO } from '@loop/shared';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { api, ApiError, errorMessage } from '../../lib/api';
import { keys, useConfig, useMe } from '../../lib/queries';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const me = useMe();
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post<{ user: UserDTO }>('/auth/login', { email, password });
      qc.setQueryData(keys.me, user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? 'Enter a valid email and password.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
      <p className="mt-1 text-sm text-muted">Sign in to {config.data?.appName ?? 'Loop Coder'}.</p>
      <form className="mt-8 space-y-4" onSubmit={submit} noValidate>
        <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" icon={LogIn} loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
      {config.data?.registrationEnabled && (
        <p className="mt-6 text-center text-[13px] text-muted">
          No account yet?{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}
