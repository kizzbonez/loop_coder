import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import {
  AGENT_STATES,
  AUTHOR_TYPES,
  COLUMN_KINDS,
  ITEM_TYPES,
  PRIORITIES,
  REMARK_KINDS,
  ROLE_SOURCES,
  SPRINT_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  WORKSPACE_ROLES,
} from '@loop/shared';

// SQLite has no native uuid/timestamp/boolean types: ids are text UUIDs, timestamps are
// epoch milliseconds and booleans are 0/1 integers. Drizzle maps them to string/Date/boolean.

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () =>
  ts('created_at')
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .$defaultFn(() => new Date());
const bool = (name: string) => integer(name, { mode: 'boolean' });

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    passwordChangedAt: ts('password_changed_at')
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at')
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workspaces_slug_uq').on(t.slug), index('workspaces_owner_idx').on(t.ownerId)],
);

/** Access to a workspace (and therefore to every project inside it). */
export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: WORKSPACE_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)],
);

export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    agentState: text('agent_state', { enum: AGENT_STATES }).notNull().default('active'),
    definitionOfReady: text('definition_of_ready').notNull().default(''),
    definitionOfDone: text('definition_of_done').notNull().default(''),
    notes: text('notes').notNull().default(''),
    sprintCapacity: integer('sprint_capacity').notNull().default(20),
    itemSeq: integer('item_seq').notNull().default(0),
    sprintSeq: integer('sprint_seq').notNull().default(0),
    kickoffCompletedAt: ts('kickoff_completed_at'),
    /** Claimant currently running a ceremony (kickoff / planning / review). */
    ceremonyClaimBy: text('ceremony_claim_by'),
    ceremonyClaimExpiresAt: ts('ceremony_claim_expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Project keys are globally unique so work-item keys (e.g. SHOP-12) are unambiguous everywhere.
  (t) => [uniqueIndex('projects_key_uq').on(t.key), index('projects_workspace_idx').on(t.workspaceId)],
);

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Optional restriction of the token to a single workspace or a single project. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    prefix: text('prefix').notNull(),
    lastClientName: text('last_client_name'),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_tokens_hash_uq').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Agent roles & board
// ---------------------------------------------------------------------------

export const agentRoles = sqliteTable(
  'agent_roles',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull(),
    color: text('color').notNull().default('#6366f1'),
    isSystem: bool('is_system').notNull().default(false),
    enabled: bool('enabled').notNull().default(true),
    /** Whether the role may be assigned to individual work items (vs. column-only roles like the reviewer). */
    assignable: bool('assignable').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_roles_key_uq').on(t.key)],
);

export const boardColumns = sqliteTable(
  'board_columns',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: COLUMN_KINDS }).notNull(),
    position: integer('position').notNull(),
    agentRoleId: text('agent_role_id').references(() => agentRoles.id, { onDelete: 'set null' }),
    roleSource: text('role_source', { enum: ROLE_SOURCES }).notNull().default('column'),
    wipLimit: integer('wip_limit'),
    color: text('color'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('board_columns_project_kind_uq').on(t.projectId, t.kind),
    uniqueIndex('board_columns_project_key_uq').on(t.projectId, t.key),
  ],
);

export const sprints = sqliteTable(
  'sprints',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    goal: text('goal').notNull().default(''),
    status: text('status', { enum: SPRINT_STATUSES }).notNull().default('planned'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    reviewNotes: text('review_notes').notNull().default(''),
    retroNotes: text('retro_notes').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sprints_project_number_uq').on(t.projectId, t.number),
    // At most one active sprint per project.
    uniqueIndex('sprints_one_active_uq').on(t.projectId).where(sql`status = 'active'`),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    type: text('type', { enum: ITEM_TYPES }).notNull().default('story'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    acceptanceCriteria: text('acceptance_criteria').notNull().default(''),
    priority: text('priority', { enum: PRIORITIES }).notNull().default('medium'),
    storyPoints: integer('story_points'),
    columnId: text('column_id')
      .notNull()
      .references(() => boardColumns.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'set null' }),
    sprintId: text('sprint_id').references(() => sprints.id, { onDelete: 'set null' }),
    assignedRoleId: text('assigned_role_id').references(() => agentRoles.id, { onDelete: 'set null' }),
    /** When set, the item is owned by a human and the agent will not pick it up. */
    assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    labels: text('labels', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    /** Meets the Definition of Ready (set during backlog refinement). */
    refined: bool('refined').notNull().default(false),
    /** Number of times the item was sent back from review/testing for rework. */
    bounceCount: integer('bounce_count').notNull().default(0),
    blockedFromColumnId: text('blocked_from_column_id'),
    claimedBy: text('claimed_by'),
    claimAgentName: text('claim_agent_name'),
    claimRoleKey: text('claim_role_key'),
    claimedAt: ts('claimed_at'),
    claimExpiresAt: ts('claim_expires_at'),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByAgent: bool('created_by_agent').notNull().default(false),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tasks_project_number_uq').on(t.projectId, t.number),
    index('tasks_project_column_idx').on(t.projectId, t.columnId),
    index('tasks_sprint_idx').on(t.sprintId),
    index('tasks_parent_idx').on(t.parentId),
    check('tasks_story_points_ck', sql`${t.storyPoints} is null or ${t.storyPoints} >= 0`),
  ],
);

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnId: text('depends_on_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnId] }),
    index('task_dependencies_depends_idx').on(t.dependsOnId),
    check('task_dependencies_no_self_ck', sql`${t.taskId} <> ${t.dependsOnId}`),
  ],
);

export const taskRemarks = sqliteTable(
  'task_remarks',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    authorType: text('author_type', { enum: AUTHOR_TYPES }).notNull(),
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Friendly name of the MCP client for agent remarks (e.g. "Claude Code", "Cursor"). */
    agentName: text('agent_name'),
    roleKey: text('role_key'),
    kind: text('kind', { enum: REMARK_KINDS }).notNull().default('comment'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('task_remarks_task_idx').on(t.taskId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Activity, agent presence, audit, settings
// ---------------------------------------------------------------------------

export const activities = sqliteTable(
  'activities',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    taskKey: text('task_key'),
    actorType: text('actor_type', { enum: AUTHOR_TYPES }).notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Friendly name of the MCP client for agent actions. */
    agentName: text('agent_name'),
    roleKey: text('role_key'),
    action: text('action').notNull(),
    message: text('message').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('activities_project_idx').on(t.projectId, t.createdAt)],
);

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenId: text('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    clientName: text('client_name'),
    startedAt: ts('started_at')
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: ts('last_seen_at')
      .notNull()
      .$defaultFn(() => new Date()),
    toolCalls: integer('tool_calls').notNull().default(0),
    itemsCompleted: integer('items_completed').notNull().default(0),
    currentTaskId: text('current_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    currentRoleKey: text('current_role_key'),
    currentActivity: text('current_activity'),
  },
  (t) => [
    index('agent_sessions_project_idx').on(t.projectId, t.lastSeenAt),
    index('agent_sessions_token_idx').on(t.tokenId, t.projectId),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    actorType: text('actor_type', { enum: AUTHOR_TYPES }).notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_action_idx').on(t.action)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: updatedAt(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ColumnRow = typeof boardColumns.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type SprintRow = typeof sprints.$inferSelect;
export type AgentRoleRow = typeof agentRoles.$inferSelect;
export type RemarkRow = typeof taskRemarks.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
