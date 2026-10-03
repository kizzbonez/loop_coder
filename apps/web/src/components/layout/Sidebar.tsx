import clsx from 'clsx';
import { BookOpen, Check, ChevronDown, KeyRound, LogOut, Monitor, Moon, Plus, Shield, SquareKanban, Sun, User, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../lib/api';
import { useConfig, useCreateWorkspace, useLogout, useMe, useWorkspaceProjects, useWorkspaces } from '../../lib/queries';
import { useTheme, type ThemePreference } from '../../lib/theme';
import { shortCommit } from '../../lib/version';
import { useCurrentWorkspaceId } from '../../lib/workspace-context';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { Menu } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/misc';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="text-[15px] font-semibold tracking-tight">Loop Coder</span>
    </div>
  );
}

function NavItem({ to, icon: Icon, label, end }: { to: string; icon: typeof User; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition',
          isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      <Icon className="size-4" />
      {label}
    </NavLink>
  );
}

function ThemeSwitch() {
  const [pref, setPref] = useTheme();
  const options: Array<[ThemePreference, typeof Sun, string]> = [
    ['light', Sun, 'Light'],
    ['dark', Moon, 'Dark'],
    ['system', Monitor, 'System'],
  ];
  return (
    <div className="flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Theme">
      {options.map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          title={label}
          onClick={() => setPref(value)}
          className={clsx('flex size-7 items-center justify-center rounded-md transition', pref === value ? 'bg-surface text-fg shadow-card' : 'text-subtle hover:text-fg')}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function NewWorkspaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New workspace"
      description="Workspaces group projects and the people who can access them."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() =>
              create.mutate(
                { name: name.trim() },
                {
                  onSuccess: (ws) => {
                    onClose();
                    setName('');
                    navigate(`/w/${ws.id}`);
                    toast.success(`Workspace “${ws.name}” created`);
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Create workspace
          </Button>
        </>
      }
    >
      <Input label="Name" placeholder="e.g. Acme Engineering" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
    </Modal>
  );
}

export function Sidebar() {
  const me = useMe();
  const config = useConfig();
  const workspaces = useWorkspaces();
  const currentId = useCurrentWorkspaceId();
  const current = workspaces.data?.find((w) => w.id === currentId);
  const projects = useWorkspaceProjects(currentId);
  const logout = useLogout();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 pb-3">
        <Link to="/" aria-label="Home">
          <Logo />
        </Link>
      </div>

      <div className="px-3">
        <Menu
          align="start"
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-2.5 py-2 text-left transition hover:border-line-strong"
            >
              <span className="brand-gradient flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white">
                {current?.name.slice(0, 1).toUpperCase() ?? '·'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{current?.name ?? 'No workspace'}</span>
                <span className="block truncate text-[11px] text-subtle">{current ? `${current.projectCount} projects · ${current.memberCount} members` : 'Create one to start'}</span>
              </span>
              <ChevronDown className="size-4 text-subtle" />
            </button>
          )}
          items={[
            ...(workspaces.data ?? []).map((w) => ({
              label: w.name,
              icon: w.id === currentId ? Check : undefined,
              onSelect: () => navigate(`/w/${w.id}`),
            })),
            { label: 'New workspace', icon: Plus, onSelect: () => setCreating(true) },
          ]}
        />
      </div>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Workspace">
        {currentId && (
          <>
            <NavItem to={`/w/${currentId}`} end icon={SquareKanban} label="Projects" />
            <NavItem to={`/w/${currentId}/members`} icon={Users} label="Members" />
          </>
        )}
        <div className="px-2.5 pt-4 pb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">Projects</div>
        {(projects.data ?? []).map((p) => (
          <NavLink
            key={p.id}
            to={`/p/${p.id}/board`}
            className={({ isActive }) =>
              clsx(
                'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition',
                isActive ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            <span className="flex h-5 min-w-8 items-center justify-center rounded bg-surface-3 px-1 font-mono text-[10px] font-semibold text-muted">{p.key}</span>
            <span className="truncate">{p.name}</span>
            {p.agentState === 'paused' && <span className="ml-auto size-1.5 rounded-full bg-warning" title="Agent paused" />}
          </NavLink>
        ))}
        {projects.data?.length === 0 && <p className="px-2.5 py-1 text-xs text-subtle">No projects yet.</p>}
      </nav>

      <div className="space-y-0.5 border-t border-line px-3 py-3">
        <NavItem to="/guide" icon={BookOpen} label="User guide" />
        <NavItem to="/account" icon={KeyRound} label="Account & tokens" />
        {me.data?.role === 'admin' && <NavItem to="/admin" icon={Shield} label="Administration" />}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-3">
        <Menu
          align="start"
          header={
            <div>
              <div className="text-[13px] font-medium">{me.data?.name}</div>
              <div className="text-xs text-subtle">{me.data?.email}</div>
            </div>
          }
          trigger={(props) => (
            <button type="button" {...props} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-surface-2">
              <Avatar name={me.data?.name} size="sm" />
              <span className="truncate text-[13px] font-medium">{me.data?.name}</span>
            </button>
          )}
          items={[
            { label: 'Account', icon: User, onSelect: () => navigate('/account') },
            { label: 'User guide', icon: BookOpen, onSelect: () => navigate('/guide') },
            {
              label: 'Sign out',
              icon: LogOut,
              onSelect: () => logout.mutate(undefined, { onSettled: () => navigate('/login') }),
            },
          ]}
        />
        <ThemeSwitch />
      </div>
      <div className="px-4 pb-3 text-[10px] text-subtle" title={config.data?.version.buildTime ?? undefined}>
        v{config.data?.version.version} · {shortCommit(config.data?.version.commit ?? 'dev')}
      </div>
      <NewWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
