import { Bot, Kanban, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '../../components/layout/Sidebar';

const POINTS = [
  { icon: Kanban, title: 'Agile by default', text: 'Backlog, sprints, Definition of Ready and Done, reviews and retrospectives.' },
  { icon: Bot, title: 'One agent, every role', text: 'Your AI coding agent works the board as PM, architect, designer, engineer, reviewer and QA.' },
  { icon: ShieldCheck, title: 'Secure and self-hosted', text: 'Runs in Docker on your machine. Your code never leaves it.' },
];

export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--accent), transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -right-32 -bottom-48 size-[480px] rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--accent-2), transparent 70%)' }}
        />
        <Logo className="relative" />
        <div className="relative max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            Ship software with an <span className="brand-text">autonomous Scrum team</span> in the loop.
          </h1>
          <ul className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Icon className="size-4.5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-[13px] text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-subtle">Works with Claude Code, Cursor, VS Code and any MCP agent</p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-sm'}>
          <Logo className="mb-8 lg:hidden" />
          {children}
        </div>
      </div>
    </div>
  );
}
