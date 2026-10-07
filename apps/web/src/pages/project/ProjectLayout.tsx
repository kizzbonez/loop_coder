import { Activity, Bot, ChevronRight, FolderTree, Gamepad2, ListTodo, Rocket, Settings, SquareKanban, Target, Workflow } from 'lucide-react';
import { Link, Outlet, useParams } from 'react-router';
import { AgentStatus, LiveIndicator } from '../../components/board/AgentStatus';
import { TaskDrawer } from '../../components/board/TaskDrawer';
import { Badge } from '../../components/ui/Badge';
import { PageLoader, ProgressBar, TabNav } from '../../components/ui/misc';
import { useProjectStream } from '../../hooks/useProjectStream';
import { percent } from '../../lib/format';
import { useProject, useRoles, useTasks } from '../../lib/queries';
import { NotFound } from '../NotFound';
import { useBoardLookups, useTaskDrawer, type ProjectContext } from './context';

export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const tasks = useTasks(projectId);
  const roles = useRoles();
  const stream = useProjectStream(projectId);
  const drawer = useTaskDrawer();

  if (project.isPending || tasks.isPending || roles.isPending) return <PageLoader />;
  if (!project.data || !tasks.data) return <NotFound what="project" />;
  return (
    // Keyed by project: switching projects starts every tab (replays, animations, the office) fresh.
    <ProjectShell
      key={projectId}
      ctx={{
        project: project.data,
        tasks: tasks.data,
        roles: roles.data ?? [],
        stream,
        canEdit: project.data.myAccess !== 'viewer',
        isOwner: project.data.myAccess === 'owner' || project.data.myAccess === 'admin',
      }}
      drawer={drawer}
    />
  );
}

function ProjectShell({ ctx, drawer }: { ctx: ProjectContext; drawer: ReturnType<typeof useTaskDrawer> }) {
  const { project, tasks, roles } = ctx;
  const lookups = useBoardLookups(project, tasks, roles);
  const nonEpics = tasks.filter((t) => t.type !== 'epic');
  const done = nonEpics.filter((t) => t.columnId === lookups.doneColumnId).length;
  const blocked = nonEpics.filter((t) => lookups.columnsById.get(t.columnId)?.kind === 'blocked').length;
  const sprint = project.activeSprint;
  const base = `/p/${project.id}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line bg-surface px-4 pt-4 sm:px-6">
        <nav className="flex items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
          <Link to={`/w/${project.workspaceId}`} className="hover:text-fg">
            {project.workspaceName}
          </Link>
          <ChevronRight className="size-3" />
          <span className="font-mono">{project.key}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
          <LiveIndicator status={ctx.stream} />
          <div className="ml-auto">
            <AgentStatus project={project} rolesByKey={lookups.rolesByKey} canEdit={ctx.canEdit} onOpenTask={drawer.openTask} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
          {sprint ? (
            <span className="flex min-w-0 items-center gap-2">
              <Target className="size-3.5 text-accent" />
              <span className="font-medium text-fg">{sprint.name}</span>
              <span className="hidden max-w-96 truncate sm:inline">{sprint.goal}</span>
              <span className="w-24">
                <ProgressBar value={percent(sprint.stats.donePoints, sprint.stats.points)} />
              </span>
              <span className="tabular-nums">
                {sprint.stats.donePoints}/{sprint.stats.points} pts
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Target className="size-3.5" /> {project.kickoffCompletedAt ? 'No active sprint' : 'Waiting for the kickoff'}
            </span>
          )}
          <span className="tabular-nums">
            {done}/{nonEpics.length} items done
          </span>
          {blocked > 0 && (
            <Link to={`${base}/board`}>
              <Badge tone="danger">{blocked} waiting for you</Badge>
            </Link>
          )}
        </div>
        <TabNav
          className="mt-2"
          items={[
            { to: `${base}/board`, label: 'Board', icon: SquareKanban },
            { to: `${base}/flow`, label: 'Flow', icon: Workflow },
            { to: `${base}/office`, label: 'Office', icon: Gamepad2 },
            { to: `${base}/backlog`, label: 'Backlog', icon: ListTodo },
            { to: `${base}/sprints`, label: 'Sprints', icon: Rocket },
            { to: `${base}/activity`, label: 'Activity', icon: Activity },
            { to: `${base}/files`, label: 'Files', icon: FolderTree },
            { to: `${base}/agent`, label: 'Agent', icon: Bot },
            ...(ctx.isOwner ? [{ to: `${base}/settings`, label: 'Settings', icon: Settings }] : []),
          ]}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet context={ctx} />
      </div>
      {drawer.taskId && <TaskDrawer ctx={ctx} lookups={lookups} taskId={drawer.taskId} onClose={drawer.closeTask} onOpenTask={drawer.openTask} />}
    </div>
  );
}
