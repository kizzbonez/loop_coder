import { Bot, CirclePause, Plus, Search, SquareKanban } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ProjectDTO } from '@loop/shared';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { EmptyState, PageLoader, ProgressRing } from '../../components/ui/misc';
import { percent, timeAgo } from '../../lib/format';
import { useWorkspaceProjects } from '../../lib/queries';
import { NewProjectModal } from './NewProjectModal';
import { useWorkspaceOutlet } from './WorkspaceLayout';

function ProjectCard({ project }: { project: ProjectDTO }) {
  const pct = percent(project.stats.done, project.stats.total);
  return (
    <Link
      to={`/p/${project.id}/board`}
      className="card group flex flex-col gap-4 p-5 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted">{project.key}</span>
          <h3 className="mt-2 truncate text-[15px] font-semibold group-hover:text-accent">{project.name}</h3>
        </div>
        <ProgressRing value={pct} />
      </div>
      <p className="line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{project.description || 'No description yet.'}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          {project.stats.done}/{project.stats.total} items
        </span>
        <span className="text-subtle">·</span>
        <span>
          {project.stats.donePoints}/{project.stats.points} pts
        </span>
        {project.stats.blocked > 0 && <Badge tone="danger">{project.stats.blocked} need you</Badge>}
        <span className="ml-auto flex items-center gap-1">
          {project.agentState === 'paused' ? (
            <Badge tone="warning">
              <CirclePause className="size-3" /> Paused
            </Badge>
          ) : !project.kickoffCompletedAt ? (
            <Badge tone="accent">
              <Bot className="size-3" /> Awaiting kickoff
            </Badge>
          ) : (
            <span className="text-subtle">updated {timeAgo(project.updatedAt)}</span>
          )}
        </span>
      </div>
    </Link>
  );
}

export function WorkspaceProjects() {
  const { workspace } = useWorkspaceOutlet();
  const projects = useWorkspaceProjects(workspace.id);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const canCreate = workspace.myAccess !== 'viewer';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
  }, [projects.data, query]);

  if (projects.isPending) return <PageLoader />;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle" />
          <Input placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" aria-label="Search projects" />
        </div>
        {canCreate && (
          <Button variant="primary" icon={Plus} className="ml-auto" onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SquareKanban}
          title={query ? 'No matching projects' : 'No projects yet'}
          description={
            query
              ? 'Try a different search.'
              : 'Create a project, describe its goal, then connect an AI coding agent (Claude Code, Cursor, VS Code…). It plans the backlog and works through it sprint by sprint.'
          }
          action={
            !query && canCreate ? (
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                Create a project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
      <NewProjectModal workspaceId={workspace.id} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
