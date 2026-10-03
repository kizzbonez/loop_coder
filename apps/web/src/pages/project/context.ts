import { useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import type { AgentRoleDTO, ColumnDTO, ProjectDetailDTO, TaskDTO } from '@loop/shared';
import type { StreamStatus } from '../../hooks/useProjectStream';

export interface ProjectContext {
  project: ProjectDetailDTO;
  tasks: TaskDTO[];
  roles: AgentRoleDTO[];
  stream: StreamStatus;
  canEdit: boolean;
  isOwner: boolean;
}

export function useProjectContext(): ProjectContext {
  return useOutletContext<ProjectContext>();
}

/** Open / close the work-item drawer via the `?task=` query parameter (shareable links). */
export function useTaskDrawer(): { openTask: (id: string) => void; closeTask: () => void; taskId: string | null } {
  const [params, setParams] = useSearchParams();
  return {
    taskId: params.get('task'),
    openTask: (id) =>
      setParams((p) => {
        p.set('task', id);
        return p;
      }),
    closeTask: () =>
      setParams((p) => {
        p.delete('task');
        return p;
      }),
  };
}

export interface BoardLookups {
  columnsById: Map<string, ColumnDTO>;
  columnByKind: (kind: ColumnDTO['kind']) => ColumnDTO | undefined;
  rolesById: Map<string, AgentRoleDTO>;
  rolesByKey: Map<string, AgentRoleDTO>;
  tasksById: Map<string, TaskDTO>;
  doneColumnId: string | undefined;
  /** The agent role that works on an item in its current stage. */
  roleFor: (task: TaskDTO) => AgentRoleDTO | undefined;
  /** Dependencies that are not done yet. */
  openDependencies: (task: TaskDTO) => TaskDTO[];
}

export function useBoardLookups(project: ProjectDetailDTO, tasks: TaskDTO[], roles: AgentRoleDTO[]): BoardLookups {
  return useMemo(() => {
    const columnsById = new Map(project.columns.map((c) => [c.id, c]));
    const rolesById = new Map(roles.map((r) => [r.id, r]));
    const rolesByKey = new Map(roles.map((r) => [r.key, r]));
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const done = project.columns.find((c) => c.kind === 'done');
    return {
      columnsById,
      columnByKind: (kind) => project.columns.find((c) => c.kind === kind),
      rolesById,
      rolesByKey,
      tasksById,
      doneColumnId: done?.id,
      roleFor: (task) => {
        if (task.claim?.roleKey) return rolesByKey.get(task.claim.roleKey);
        const column = columnsById.get(task.columnId);
        if (!column) return undefined;
        if (column.roleSource === 'task' && task.assignedRoleId) return rolesById.get(task.assignedRoleId);
        return column.agentRoleId ? rolesById.get(column.agentRoleId) : undefined;
      },
      openDependencies: (task) =>
        task.dependsOn.map((id) => tasksById.get(id)).filter((t): t is TaskDTO => Boolean(t) && t!.columnId !== done?.id),
    };
  }, [project.columns, roles, tasks]);
}
