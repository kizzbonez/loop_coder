import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  AccessLevel,
  AgentState,
  ColumnDTO,
  ColumnKind,
  CreateProjectInput,
  ProjectDetailDTO,
  ProjectDTO,
  ProjectEvent,
  ProjectStatsDTO,
  RoleSource,
  UpdateColumnInput,
  UpdateProjectInput,
} from '@loop/shared';
import { createProjectSchema } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import {
  boardColumns,
  projects,
  tasks,
  workspaceMembers,
  workspaces,
  type ProjectRow,
  type WorkspaceRow,
} from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { now } from '../../lib/time';
import { EventBatch } from '../../realtime/bus';
import { actorLabel, recordActivity } from '../activity/activity.service';
import { audit } from '../audit/audit.service';
import { getPresence, listOnlineAgents } from '../presence/presence.service';
import { DEFAULT_DEFINITION_OF_DONE, DEFAULT_DEFINITION_OF_READY } from '../roles/default-roles';
import { getRoleById, getRoleByKey } from '../roles/roles.service';
import { getSettings } from '../settings/settings.service';
import { getActiveSprintDTO } from '../sprints/sprints.query';
import { getProjectAccess, requireProjectAccess, requireWorkspaceAccess } from './access';
import { getColumns, getProjectByKey, getProjectRow, toColumnDTO } from './projects.query';

interface ColumnTemplate {
  kind: ColumnKind;
  name: string;
  roleKey: string | null;
  roleSource: RoleSource;
  color: string;
}

/** Default SDLC/Scrum workflow for every new project board. */
export const DEFAULT_COLUMNS: ColumnTemplate[] = [
  { kind: 'backlog', name: 'Backlog', roleKey: 'project_manager', roleSource: 'column', color: '#8b5cf6' },
  // The item's own role works it; items without one go to the Senior Developer.
  { kind: 'todo', name: 'To Do', roleKey: 'senior_developer', roleSource: 'task', color: '#64748b' },
  { kind: 'in_progress', name: 'In Progress', roleKey: 'senior_developer', roleSource: 'task', color: '#3b82f6' },
  { kind: 'review', name: 'Code Review', roleKey: 'code_reviewer', roleSource: 'column', color: '#f59e0b' },
  { kind: 'testing', name: 'QA / Testing', roleKey: 'qa_engineer', roleSource: 'column', color: '#14b8a6' },
  { kind: 'blocked', name: 'Needs Human', roleKey: null, roleSource: 'column', color: '#ef4444' },
  { kind: 'done', name: 'Done', roleKey: null, roleSource: 'column', color: '#22c55e' },
];

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const EMPTY_STATS: ProjectStatsDTO = { total: 0, done: 0, points: 0, donePoints: 0, blocked: 0 };

export function projectStats(exec: Executor, projectIds: string[]): Map<string, ProjectStatsDTO> {
  const result = new Map<string, ProjectStatsDTO>(projectIds.map((id) => [id, { ...EMPTY_STATS }]));
  if (projectIds.length === 0) return result;
  const rows = exec
    .select({
      projectId: tasks.projectId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${boardColumns.kind} = 'done' then 1 else 0 end)`,
      points: sql<number>`coalesce(sum(${tasks.storyPoints}), 0)`,
      donePoints: sql<number>`coalesce(sum(case when ${boardColumns.kind} = 'done' then ${tasks.storyPoints} else 0 end), 0)`,
      blocked: sql<number>`sum(case when ${boardColumns.kind} = 'blocked' then 1 else 0 end)`,
    })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(and(inArray(tasks.projectId, projectIds), ne(tasks.type, 'epic')))
    .groupBy(tasks.projectId)
    .all();
  for (const r of rows) {
    result.set(r.projectId, {
      total: Number(r.total),
      done: Number(r.done ?? 0),
      points: Number(r.points ?? 0),
      donePoints: Number(r.donePoints ?? 0),
      blocked: Number(r.blocked ?? 0),
    });
  }
  return result;
}

export function toProjectDTO(
  p: ProjectRow,
  ws: Pick<WorkspaceRow, 'slug' | 'name'>,
  access: AccessLevel,
  stats: ProjectStatsDTO,
): ProjectDTO {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    workspaceSlug: ws.slug,
    workspaceName: ws.name,
    key: p.key,
    name: p.name,
    description: p.description,
    createdById: p.createdById,
    agentState: p.agentState,
    definitionOfReady: p.definitionOfReady,
    definitionOfDone: p.definitionOfDone,
    notes: p.notes,
    sprintCapacity: p.sprintCapacity,
    kickoffCompletedAt: p.kickoffCompletedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    myAccess: access,
    stats,
    workspacePath: `${ws.slug}/${p.key.toLowerCase()}`,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function projectWithWorkspace(exec: Executor, where: ReturnType<typeof eq> | undefined) {
  return exec
    .select({ project: projects, ws: { slug: workspaces.slug, name: workspaces.name } })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(where);
}

/**
 * The realtime event for a changed project. It goes to everyone watching the project, so it leaves
 * out `myAccess` (that is the access level of whoever made the change, not of the viewer).
 */
export function projectUpdatedEvent(dto: ProjectDTO): ProjectEvent {
  const { myAccess: _actorAccess, ...project } = dto;
  return { type: 'project.updated', project };
}

export function getProjectDTO(actor: Actor, projectId: string, exec: Executor = db): ProjectDTO {
  const access = requireProjectAccess(actor, projectId, 'viewer', exec);
  const row = projectWithWorkspace(exec, eq(projects.id, projectId)).get();
  if (!row) throw notFound('Project');
  return toProjectDTO(row.project, row.ws, access, projectStats(exec, [projectId]).get(projectId)!);
}

/** Projects of one workspace, or of every workspace the user belongs to when no id is given. */
export function listProjects(actor: Actor, workspaceId?: string): ProjectDTO[] {
  let rows: Array<{ project: ProjectRow; ws: { slug: string; name: string } }>;
  if (workspaceId) {
    requireWorkspaceAccess(actor, workspaceId, 'viewer');
    rows = projectWithWorkspace(db, eq(projects.workspaceId, workspaceId)).orderBy(asc(projects.name)).all();
  } else {
    const memberOf = db
      .select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, actor.userId))
      .all()
      .map((r) => r.id);
    rows =
      memberOf.length === 0
        ? []
        : projectWithWorkspace(db, inArray(projects.workspaceId, memberOf)).orderBy(asc(projects.name)).all();
  }
  const visible = rows
    .map((r) => ({ ...r, access: getProjectAccess(actor, r.project.id) }))
    .filter((r): r is typeof r & { access: AccessLevel } => r.access !== null);
  const stats = projectStats(db, visible.map((r) => r.project.id));
  return visible.map((r) => toProjectDTO(r.project, r.ws, r.access, stats.get(r.project.id)!));
}

export function listAllProjects(): ProjectDTO[] {
  const rows = projectWithWorkspace(db, undefined).orderBy(asc(workspaces.name), asc(projects.name)).all();
  const stats = projectStats(db, rows.map((r) => r.project.id));
  return rows.map((r) => toProjectDTO(r.project, r.ws, 'admin', stats.get(r.project.id)!));
}

export function getProjectDetail(actor: Actor, projectId: string): ProjectDetailDTO {
  const project = getProjectDTO(actor, projectId);
  return {
    ...project,
    columns: getColumns(projectId).map(toColumnDTO),
    activeSprint: getActiveSprintDTO(projectId),
    agent: getPresence(projectId),
    agents: listOnlineAgents(projectId),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function createProject(actor: Actor, input: CreateProjectInput): ProjectDetailDTO {
  const data = createProjectSchema.parse(input);
  requireWorkspaceAccess(actor, data.workspaceId, 'editor');
  const batch = new EventBatch();

  const project = db.transaction((tx) => {
    if (getProjectByKey(data.key, tx)) throw conflict(`The project key "${data.key}" is already in use`);
    const p = tx
      .insert(projects)
      .values({
        workspaceId: data.workspaceId,
        key: data.key,
        name: data.name,
        description: data.description,
        createdById: actor.userId,
        sprintCapacity: data.sprintCapacity ?? getSettings().general.defaultSprintCapacity,
        definitionOfReady: DEFAULT_DEFINITION_OF_READY,
        definitionOfDone: DEFAULT_DEFINITION_OF_DONE,
      })
      .returning()
      .get();

    DEFAULT_COLUMNS.forEach((col, position) => {
      tx.insert(boardColumns)
        .values({
          projectId: p.id,
          key: col.kind,
          name: col.name,
          kind: col.kind,
          position,
          agentRoleId: col.roleKey ? (getRoleByKey(col.roleKey, tx)?.id ?? null) : null,
          roleSource: col.roleSource,
          color: col.color,
        })
        .run();
    });

    recordActivity(tx, batch, {
      projectId: p.id,
      actor,
      action: 'project.created',
      message: `${actorLabel(actor)} created the project`,
    });
    return p;
  });

  batch.flush();
  audit({ action: 'project.created', actor, targetType: 'project', targetId: project.id, metadata: { key: project.key } });
  return getProjectDetail(actor, project.id);
}

/** Activity for each agent state change: agent.resumed, agent.paused, agent.stopped. */
const AGENT_STATE_VERBS: Record<AgentState, string> = { active: 'resumed', paused: 'paused', stopped: 'stopped' };

export function updateProject(actor: Actor, projectId: string, patch: UpdateProjectInput): ProjectDTO {
  const onlyAgentState = Object.keys(patch).every((k) => k === 'agentState');
  requireProjectAccess(actor, projectId, onlyAgentState ? 'editor' : 'owner');
  const before = getProjectRow(projectId);
  const batch = new EventBatch();

  db.transaction((tx) => {
    tx.update(projects)
      .set({ ...patch, updatedAt: now() })
      .where(eq(projects.id, projectId))
      .run();
    if (patch.agentState && patch.agentState !== before.agentState) {
      const verb = AGENT_STATE_VERBS[patch.agentState];
      recordActivity(tx, batch, { projectId, actor, action: `agent.${verb}`, message: `${actorLabel(actor)} ${verb} the agent` });
    }
  });

  const dto = getProjectDTO(actor, projectId);
  batch.add(projectId, projectUpdatedEvent(dto));
  batch.flush();

  if (patch.agentState && patch.agentState !== before.agentState) {
    audit({ action: `project.agent_${patch.agentState}`, actor, targetType: 'project', targetId: projectId });
  }
  const otherFields = Object.keys(patch).filter((k) => k !== 'agentState');
  if (otherFields.length) {
    audit({ action: 'project.updated', actor, targetType: 'project', targetId: projectId, metadata: { fields: otherFields } });
  }
  return dto;
}

export function deleteProject(actor: Actor, projectId: string): void {
  requireProjectAccess(actor, projectId, 'owner');
  const p = getProjectRow(projectId);
  db.delete(projects).where(eq(projects.id, projectId)).run();
  const batch = new EventBatch();
  batch.add(projectId, { type: 'project.deleted', projectId });
  batch.flush();
  audit({ action: 'project.deleted', actor, targetType: 'project', targetId: projectId, metadata: { key: p.key } });
}

export function updateColumn(actor: Actor, projectId: string, columnId: string, patch: UpdateColumnInput): ColumnDTO[] {
  requireProjectAccess(actor, projectId, 'owner');
  const column = db
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))
    .get();
  if (!column) throw notFound('Column');
  if (patch.agentRoleId) {
    const role = getRoleById(patch.agentRoleId);
    if (!role) throw badRequest('Unknown agent role');
  }
  if ((column.kind === 'done' || column.kind === 'blocked') && patch.agentRoleId) {
    throw badRequest(`The "${column.name}" column is for humans and finished work; it cannot have an agent role`);
  }
  db.update(boardColumns).set(patch).where(eq(boardColumns.id, columnId)).run();
  const columns = getColumns(projectId).map(toColumnDTO);
  const batch = new EventBatch();
  batch.add(projectId, { type: 'columns.updated', columns });
  batch.flush();
  audit({ action: 'project.column_updated', actor, targetType: 'project', targetId: projectId, metadata: { columnId, fields: Object.keys(patch) } });
  return columns;
}
