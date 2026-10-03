// Domain vocabulary shared by the API, the MCP server and the web UI.

export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Workspace membership roles. Projects live inside a workspace and inherit its access:
 *  - viewer: read boards, backlog, sprints and activity
 *  - editor: manage work items and sprints, comment, pause/resume the agent
 *  - owner:  everything, plus project/workspace settings and members
 * Platform admins implicitly have full access to every workspace.
 */
export const WORKSPACE_ROLES = ['owner', 'editor', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type AccessLevel = WorkspaceRole | 'admin';

export const ACCESS_RANK: Record<AccessLevel, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
  admin: 4,
};

/**
 * Workflow stages of the board, in SDLC order. Every project has exactly one
 * column per kind; names, colours, WIP limits and agent roles are configurable.
 */
export const COLUMN_KINDS = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'testing',
  'blocked',
  'done',
] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

/** Columns the agent actively works in while a sprint is running. */
export const SPRINT_WORK_KINDS: readonly ColumnKind[] = ['todo', 'in_progress', 'review', 'testing'];

export const ITEM_TYPES = ['epic', 'story', 'task', 'bug', 'spike'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Modified Fibonacci scale used for story point estimates. */
export const STORY_POINTS = [0, 1, 2, 3, 5, 8, 13, 21] as const;

export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

/** Whether the agent may pick up work in a project (controlled from the UI). */
export const AGENT_STATES = ['active', 'paused'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export const REMARK_KINDS = [
  'comment',
  'work_log',
  'design',
  'review',
  'test_report',
  'question',
  'answer',
  'system',
] as const;
export type RemarkKind = (typeof REMARK_KINDS)[number];

/** Remark kinds a human may post from the UI. */
export const HUMAN_REMARK_KINDS = ['comment', 'answer'] as const;

export const AUTHOR_TYPES = ['user', 'agent', 'system'] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

/** Where the agent role for a column comes from: the column itself or the task's assigned role. */
export const ROLE_SOURCES = ['column', 'task'] as const;
export type RoleSource = (typeof ROLE_SOURCES)[number];

export const CEREMONIES = ['kickoff', 'sprint_planning', 'sprint_review'] as const;
export type Ceremony = (typeof CEREMONIES)[number];

/** Keys of the built-in agent roles that are seeded on first start. */
export const SYSTEM_ROLE_KEYS = [
  'project_manager',
  'architect',
  'ui_designer',
  'software_engineer',
  'code_reviewer',
  'qa_engineer',
  'devops_engineer',
  'security_engineer',
  'tech_writer',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const MCP_SERVER_NAME = 'loopcoder';

export function formatTaskKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}
