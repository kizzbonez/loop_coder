import clsx from 'clsx';
import type { ReactNode } from 'react';
import { tint } from '../../lib/meta';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Pill tinted with an arbitrary hex colour (roles, labels, columns). */
export function Chip({ color, children, className, dot = false }: { color: string; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={clsx('inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-[11px] font-medium', className)}
      style={{ backgroundColor: tint(color), color }}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}
