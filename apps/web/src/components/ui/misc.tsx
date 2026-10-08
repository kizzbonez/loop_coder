import clsx from 'clsx';
import { Check, Copy, LoaderCircle, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { initials } from '../../lib/format';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <LoaderCircle aria-label={label} className={clsx('size-5 animate-spin text-muted', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ name, size = 'md', className }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-semibold text-muted',
        { sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-10 text-sm' }[size],
        className,
      )}
      title={name ?? undefined}
    >
      {initials(name)}
    </span>
  );
}

export function ProgressBar({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'success' }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-[width] duration-500', tone === 'brand' ? 'brand-gradient' : 'bg-success')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function ProgressRing({ value, size = 44, stroke = 4, label }: { value: number; size?: number; stroke?: number; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const gradientId = `ring-${size}-${stroke}`;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute text-[11px] font-semibold">{label ?? `${v}%`}</span>
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked: the value stays selectable */
        }
      }}
      className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-3 hover:text-fg', className)}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={clsx('group relative rounded-lg border border-line bg-surface-2', className)}>
      <pre className="overflow-x-auto p-3 pr-20 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-fg">{code}</pre>
      <CopyButton value={code} className="absolute top-2 right-2 bg-surface" />
    </div>
  );
}

export interface TabItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  end?: boolean;
  badge?: ReactNode;
}

export function TabNav({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav className={clsx('-mb-px flex gap-1 overflow-x-auto', className)} aria-label="Sections">
      {items.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            clsx(
              'inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition',
              isActive ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )
          }
        >
          {Icon && <Icon className="size-4" />}
          {label}
          {badge}
        </NavLink>
      ))}
    </nav>
  );
}

export function Section({ title, description, children, actions }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  // Named by its heading, so assistive technology can jump between sections.
  const headingId = useId();
  return (
    <section className="card p-5" aria-labelledby={headingId}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-[15px] font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StatCard({ label, value, icon: Icon, hint }: { label: string; value: ReactNode; icon: LucideIcon; hint?: ReactNode }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="truncate text-xs text-muted">{label}</div>
        {hint && <div className="truncate text-[11px] text-subtle">{hint}</div>}
      </div>
    </div>
  );
}
