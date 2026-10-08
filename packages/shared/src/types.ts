import type {
  GitMode,
  AccessLevel,
  AgentState,
  AuthorType,
  Ceremony,
  ColumnKind,
  ItemType,
  Priority,
  RemarkKind,
  RoleSource,
  SprintStatus,
  UserRole,
  UserStatus,
  WorkspaceRole,
} from './constants';

// All timestamps are ISO-8601 strings on the wire.

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

export interface SessionDTO {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface ApiTokenDTO {
  id: string;
  name: string;
  prefix: string;
  workspaceId: string | null;
  workspaceName: string | null;
  projectId: string | null;
  projectName: string | null;
  userId: string;
  userEmail?: string;
  /** The roles the agent using this token plays; null means every role. */
  roleKeys: string[] | null;
  /** The MCP client that last connected with it (e.g. "claude-code 2.1.0"), or null if none yet. */
  clientName: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedTokenDTO {
  token: ApiTokenDTO;
  /** Plain-text secret. Shown exactly once. */
  secret: string;
}

export interface AgentRoleDTO {
  id: string;
  key: string;
  name: string;
  description: string;
  instructions: string;
  color: string;
  isSystem: boolean;
  enabled: boolean;
  assignable: boolean;
}

export interface ColumnDTO {
  id: string;
  projectId: string;
  key: string;
  name: string;
  kind: ColumnKind;
  position: number;
  agentRoleId: string | null;
  roleSource: RoleSource;
  wipLimit: number | null;
  color: string | null;
}

export interface ProjectStatsDTO {
  total: number;
  done: number;
  points: number;
  donePoints: number;
  blocked: number;
}

export interface WorkspaceDTO {
  id: string;
  slug: string;
  name: string;
  description: string;
  ownerId: string;
  ownerName: string | null;
  myAccess: AccessLevel;
  projectCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDTO {
  id: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  key: string;
  name: string;
  description: string;
  createdById: string | null;
  agentState: AgentState;
  definitionOfReady: string;
  definitionOfDone: string;
  notes: string;
  sprintCapacity: number;
  /** "worktrees": each agent works in its own git worktree, one branch per item. */
  gitMode: GitMode;
  /** The branch finished work is merged into (worktree mode). */
  baseBranch: string;
  kickoffCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  myAccess: AccessLevel;
  stats: ProjectStatsDTO;
  /** Folder of this project's code, relative to the workspaces root: <workspace-slug>/<project-key>. */
  workspacePath: string;
}

export interface AgentPresenceDTO {
  online: boolean;
  lastSeenAt: string | null;
  /** Raw MCP client identity, e.g. "claude-code 2.1.0". */
  clientName: string | null;
  /** Friendly agent name, e.g. "Claude Code", "Cursor", "Agent". */
  agentName: string | null;
  userName: string | null;
  currentTaskId: string | null;
  currentTaskKey: string | null;
  currentRoleKey: string | null;
  /** Scrum ceremony the agent is running, if any. */
  currentCeremony: Ceremony | null;
  currentActivity: string | null;
}

/** A stretch of a project's history that can be replayed on its own. */
export interface ReplaySegmentDTO {
  /** `all`, `kickoff`, `sprint-<number>` or `latest` (since the last sprint or the kickoff). */
  id: string;
  label: string;
  /** The sprint goal, for sprints. */
  detail: string | null;
  from: string;
  /** When it ended, or null while it is still going on. */
  to: string | null;
}

/** One row of the presence log: what an agent showed from this moment on. */
export interface PresenceEntryDTO {
  sessionId: string;
  agentName: string;
  userName: string | null;
  at: string;
  taskId: string | null;
  taskKey: string | null;
  roleKey: string | null;
  ceremony: Ceremony | null;
  activity: string | null;
}

/** Everything needed to replay one segment exactly as it happened. */
export interface ReplayDTO {
  segments: ReplaySegmentDTO[];
  segment: ReplaySegmentDTO;
  /**
   * Every activity from the segment's start until now, newest first like the activity feed. Moves
   * after the segment are needed too: the board at its start is rebuilt by undoing them.
   */
  events: ActivityDTO[];
  /** Remarks written during the segment, oldest first (bodies shortened to what is spoken). */
  remarks: RemarkDTO[];
  /** Presence log rows of the segment (and the online window before it), oldest first. */
  presence: PresenceEntryDTO[];
  /** When the presence log starts for this project; earlier moments are inferred from events. */
  presenceSince: string | null;
  onlineWindowMinutes: number;
  /** True when a size limit cut the data (very long histories), so the replay may be approximate. */
  truncated: boolean;
}

/** One agent connection (MCP token) active on a project right now. */
export interface OnlineAgentDTO {
  /** Agent session id; stable while the agent keeps working. */
  id: string;
  agentName: string;
  clientName: string | null;
  userName: string | null;
  lastSeenAt: string;
  currentTaskId: string | null;
  currentTaskKey: string | null;
  currentRoleKey: string | null;
  currentCeremony: Ceremony | null;
  currentActivity: string | null;
}

export interface ProjectDetailDTO extends ProjectDTO {
  columns: ColumnDTO[];
  activeSprint: SprintDTO | null;
  /** The most recently active agent (online or not). */
  agent: AgentPresenceDTO;
  /** Every agent online on this project, most recent first. */
  agents: OnlineAgentDTO[];
}

export interface TaskClaimDTO {
  by: string;
  /** Friendly name of the agent holding the claim, e.g. "Claude Code". */
  agentName: string;
  roleKey: string | null;
  at: string;
  expiresAt: string;
}

export interface TaskDTO {
  id: string;
  projectId: string;
  key: string;
  number: number;
  type: ItemType;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: Priority;
  storyPoints: number | null;
  columnId: string;
  position: number;
  parentId: string | null;
  sprintId: string | null;
  assignedRoleId: string | null;
  assigneeUserId: string | null;
  labels: string[];
  refined: boolean;
  bounceCount: number;
  dependsOn: string[];
  claim: TaskClaimDTO | null;
  createdByAgent: boolean;
  remarkCount: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemarkDTO {
  id: string;
  taskId: string;
  projectId: string;
  authorType: AuthorType;
  authorUserId: string | null;
  authorName: string | null;
  roleKey: string | null;
  kind: RemarkKind;
  body: string;
  createdAt: string;
}

export interface TaskDetailDTO extends TaskDTO {
  remarks: RemarkDTO[];
}

export interface SprintStatsDTO {
  total: number;
  done: number;
  points: number;
  donePoints: number;
}

export interface SprintDTO {
  id: string;
  projectId: string;
  number: number;
  name: string;
  goal: string;
  status: SprintStatus;
  startedAt: string | null;
  completedAt: string | null;
  reviewNotes: string;
  retroNotes: string;
  createdAt: string;
  stats: SprintStatsDTO;
}

export interface BurndownPointDTO {
  at: string;
  remainingPoints: number;
}

export interface ActivityDTO {
  id: string;
  projectId: string;
  taskId: string | null;
  taskKey: string | null;
  actorType: AuthorType;
  actorUserId: string | null;
  actorName: string | null;
  roleKey: string | null;
  action: string;
  message: string;
  /** Stage the work item left, for moves (null when unknown or not a move). */
  fromKind: ColumnKind | null;
  /** Stage the work item entered, for moves and newly created items. */
  toKind: ColumnKind | null;
  /** Ceremony that started, for `ceremony.started`. */
  ceremony: Ceremony | null;
  createdAt: string;
}

export interface MemberDTO {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface AuditLogDTO {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorType: AuthorType;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AgentSessionDTO {
  id: string;
  projectId: string;
  projectName?: string;
  userId: string;
  userName: string | null;
  tokenId: string;
  clientName: string | null;
  agentName: string;
  startedAt: string;
  lastSeenAt: string;
  toolCalls: number;
  itemsCompleted: number;
  online: boolean;
}

export interface AdminStatsDTO {
  users: number;
  activeUsers: number;
  admins: number;
  workspaces: number;
  projects: number;
  tasks: number;
  tasksDone: number;
  activeTokens: number;
  onlineAgents: number;
  sessions24h: number;
  failedLogins24h: number;
}

export interface PublicConfigDTO {
  appName: string;
  registrationEnabled: boolean;
  passwordMinLength: number;
  /** True until the onboarding wizard has created the first administrator. */
  setupRequired: boolean;
  version: VersionDTO;
}

export interface VersionDTO {
  version: string;
  commit: string;
  buildTime: string | null;
}

export interface SystemInfoDTO {
  version: VersionDTO;
  node: string;
  uptimeSeconds: number;
  database: {
    path: string;
    sizeBytes: number;
    schemaVersion: number;
  };
  workspacesConfigured: boolean;
}

export interface FileEntryDTO {
  name: string;
  type: 'file' | 'dir';
  size: number;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Events pushed to browsers over Server-Sent Events, scoped to a project. */
export type ProjectEvent =
  | { type: 'task.upserted'; task: TaskDTO }
  | { type: 'task.deleted'; taskId: string }
  | { type: 'remark.created'; remark: RemarkDTO }
  /** Without `myAccess`: every viewer keeps their own access level. */
  | { type: 'project.updated'; project: Omit<ProjectDTO, 'myAccess'> }
  | { type: 'project.deleted'; projectId: string }
  | { type: 'columns.updated'; columns: ColumnDTO[] }
  | { type: 'sprint.upserted'; sprint: SprintDTO }
  | { type: 'activity.created'; activity: ActivityDTO }
  | { type: 'agent.presence'; agent: AgentPresenceDTO; agents: OnlineAgentDTO[] };

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------

export interface AiProviderDTO {
  id: string;
  name: string;
  preset: string;
  kind: 'anthropic' | 'openai_compatible';
  baseUrl: string;
  /** The model agents use by default. */
  model: string;
  enabled: boolean;
  /** The key is never returned: only whether it can be used and its last characters. */
  key: { hint: string | null; status: 'ok' | 'locked' };
  lastTest: { at: string; ok: boolean; message: string } | null;
  /** Models the provider listed at the last successful test. */
  models: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AiProvidersDTO {
  items: AiProviderDTO[];
  /** False until LOOP_SECRETS_KEY is set on the server: keys cannot be saved or used. */
  secretsConfigured: boolean;
  /** Hosts the egress gateway lets the server reach (those of enabled providers). */
  allowedHosts: string[];
}

export interface AiProviderTestDTO {
  ok: boolean;
  message: string;
  models: string[];
  provider: AiProviderDTO;
}
