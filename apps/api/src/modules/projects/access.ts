import { and, eq } from 'drizzle-orm';
import { ACCESS_RANK, type AccessLevel } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import { projects, workspaceMembers, workspaces } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { forbidden, notFound } from '../../lib/errors';

type AccessSubject = Pick<Actor, 'userId' | 'userRole' | 'tokenProjectId' | 'tokenWorkspaceId'>;

function memberRole(userId: string, workspaceId: string, exec: Executor): AccessLevel | null {
  const member = exec
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .get();
  return member?.role ?? null;
}

/**
 * Effective access to a workspace, or null when it is invisible to the caller.
 * Platform admins see every workspace. Project-scoped tokens never get workspace-level access.
 */
export function getWorkspaceAccess(subject: AccessSubject, workspaceId: string, exec: Executor = db): AccessLevel | null {
  if (subject.tokenProjectId) return null;
  if (subject.tokenWorkspaceId && subject.tokenWorkspaceId !== workspaceId) return null;
  const ws = exec.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!ws) return null;
  if (subject.userRole === 'admin') return 'admin';
  return memberRole(subject.userId, workspaceId, exec);
}

/** Effective access to a project: inherited from its workspace, narrowed by token scope. */
export function getProjectAccess(subject: AccessSubject, projectId: string, exec: Executor = db): AccessLevel | null {
  if (subject.tokenProjectId && subject.tokenProjectId !== projectId) return null;
  const project = exec
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return null;
  if (subject.tokenWorkspaceId && subject.tokenWorkspaceId !== project.workspaceId) return null;
  if (subject.userRole === 'admin') return 'admin';
  return memberRole(subject.userId, project.workspaceId, exec);
}

export function hasAccess(access: AccessLevel | null, min: AccessLevel): boolean {
  return access !== null && ACCESS_RANK[access] >= ACCESS_RANK[min];
}

function denied(min: AccessLevel): never {
  throw forbidden(min === 'owner' ? 'Only workspace owners can do that' : 'You have read-only access here');
}

/** 404 when invisible (existence is not leaked), 403 when visible but the level is insufficient. */
export function requireWorkspaceAccess(
  subject: AccessSubject,
  workspaceId: string,
  min: AccessLevel,
  exec: Executor = db,
): AccessLevel {
  const access = getWorkspaceAccess(subject, workspaceId, exec);
  if (!access) throw notFound('Workspace');
  if (!hasAccess(access, min)) denied(min);
  return access;
}

export function requireProjectAccess(
  subject: AccessSubject,
  projectId: string,
  min: AccessLevel,
  exec: Executor = db,
): AccessLevel {
  const access = getProjectAccess(subject, projectId, exec);
  if (!access) throw notFound('Project');
  if (!hasAccess(access, min)) denied(min);
  return access;
}
