import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useProject, useWorkspaces } from './queries';

const KEY = 'lc-last-workspace';

export function rememberWorkspace(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function lastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * The workspace the user is currently in: from the URL (/w/:id or the open project's
 * workspace), else the last one visited, else the first one they belong to.
 */
export function useCurrentWorkspaceId(): string | undefined {
  const { workspaceId, projectId } = useParams();
  const project = useProject(projectId ?? '');
  const workspaces = useWorkspaces();
  const fromRoute = workspaceId ?? (projectId ? project.data?.workspaceId : undefined);

  useEffect(() => {
    if (fromRoute) rememberWorkspace(fromRoute);
  }, [fromRoute]);

  if (fromRoute) return fromRoute;
  const remembered = lastWorkspace();
  const list = workspaces.data ?? [];
  if (remembered && list.some((w) => w.id === remembered)) return remembered;
  return list[0]?.id;
}
