import { z } from 'zod';
import { AI_PROVIDER_PRESET_IDS } from './providers';
import {
  AGENT_STATES,
  GIT_MODES,
  COLUMN_KINDS,
  HUMAN_REMARK_KINDS,
  ITEM_TYPES,
  PRIORITIES,
  ROLE_SOURCES,
  STORY_POINTS,
  USER_ROLES,
  USER_STATUSES,
  WORKSPACE_ROLES,
} from './constants';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** Length/complexity beyond this is enforced server-side from admin settings. */
export const passwordSchema = z.string().min(1).max(256);
export const nameSchema = z.string().trim().min(1).max(100);
export const uuidSchema = z.uuid();
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour like #6366f1');
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'Lowercase letters, digits and dashes (max 40)');
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,7}$/, '2–8 characters, letters and digits, starting with a letter');
/**
 * A git branch name that is also safe inside the shell commands agents are given: letters,
 * digits, ".", "_", "-" and "/"-separated parts, none starting with "." or "-", no "..", and
 * not ending in ".lock".
 */
export const branchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/, 'Use letters, digits, ".", "_", "-" and "/" (for example main or release/2.0)')
  .refine((b) => !b.includes('..') && !b.endsWith('.lock') && !b.endsWith('.'), 'Not a valid git branch name');
export const storyPointsSchema = z
  .number()
  .int()
  .refine((n) => (STORY_POINTS as readonly number[]).includes(n), 'Use the Fibonacci scale: 0,1,2,3,5,8,13,21');
export const labelsSchema = z.array(z.string().trim().min(1).max(30)).max(10);

// ---------------------------------------------------------------------------
// Auth & account
// ---------------------------------------------------------------------------

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });

/** First-run onboarding wizard: creates the platform administrator. */
export const setupSchema = z.object({
  setupCode: z.string().trim().min(1).max(128),
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  appName: z.string().trim().min(1).max(60).default('Loop Coder'),
  registrationEnabled: z.boolean().default(false),
  workspaceName: z.string().trim().min(1).max(80).default('My Workspace'),
});
export const registerSchema = z.object({ email: emailSchema, name: nameSchema, password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: passwordSchema, newPassword: passwordSchema });
export const updateProfileSchema = z.object({ name: nameSchema });
/**
 * An AI provider's API address: https only, a host name (no credentials, query or fragment),
 * without a trailing slash. Only hosts configured here are reachable through the egress gateway.
 */
export const providerBaseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a full https:// address' });
      return z.NEVER;
    }
    const host = url.hostname;
    if (url.protocol !== 'https:') ctx.addIssue({ code: 'custom', message: 'Use an https:// address' });
    else if (url.username || url.password) ctx.addIssue({ code: 'custom', message: 'Do not put credentials in the address' });
    else if (url.search || url.hash) ctx.addIssue({ code: 'custom', message: 'Remove the query or #fragment' });
    else if (url.port && url.port !== '443') ctx.addIssue({ code: 'custom', message: 'Only the standard HTTPS port is allowed' });
    else if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(host) || /^[\d.]+$/.test(host)) ctx.addIssue({ code: 'custom', message: 'Use a host name, not an IP address' });
    else return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    return z.NEVER;
  });
/** A model name as providers write them (e.g. claude-opus-5-5, gpt-x, models/gemini-x, qwen-max). */
export const modelNameSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9._:/@-]*$/, 'Letters, digits and . _ : / @ - only');
/** An API key: printable characters without spaces. */
export const apiKeySchema = z
  .string()
  .trim()
  .min(8, 'That does not look like an API key')
  .max(500)
  .regex(/^[\x21-\x7e]+$/, 'An API key has no spaces or special characters');

export const createAiProviderSchema = z.object({
  name: z.string().trim().min(1).max(60),
  preset: z.enum(AI_PROVIDER_PRESET_IDS),
  /** Defaults to the preset's address; required for "custom". */
  baseUrl: providerBaseUrlSchema.optional(),
  model: modelNameSchema.default(''),
  apiKey: apiKeySchema,
  enabled: z.boolean().default(true),
});
export const updateAiProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    baseUrl: providerBaseUrlSchema,
    model: modelNameSchema,
    /** A new key replaces the stored one; leave it out to keep the stored key. */
    apiKey: apiKeySchema,
    enabled: z.boolean(),
  })
  .partial();

/** A set of agent role keys (lowercase, as in the Agent roles list). */
export const agentRoleKeysSchema = z
  .array(z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Unknown role'))
  .min(1, 'Choose at least one role, or allow every role')
  .max(30)
  .transform((keys) => [...new Set(keys)]);
export const updateTokenSchema = z.object({ roleKeys: agentRoleKeysSchema.nullable() });

export const createTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    /** Optional scope: restrict the token to one workspace or one project. */
    workspaceId: uuidSchema.nullable().optional(),
    projectId: uuidSchema.nullable().optional(),
    expiresInDays: z.number().int().min(1).max(365),
    /** The roles this agent plays; omitted or null for every role. */
    roleKeys: agentRoleKeysSchema.nullable().optional(),
  })
  .refine((v) => !(v.workspaceId && v.projectId), {
    message: 'Scope a token to a workspace or a project, not both',
    path: ['projectId'],
  });

// ---------------------------------------------------------------------------
// Workspaces, members
// ---------------------------------------------------------------------------

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema.optional(),
  description: z.string().max(2000).default(''),
});
export const updateWorkspaceSchema = z
  .object({ name: z.string().trim().min(1).max(80), slug: slugSchema, description: z.string().max(2000) })
  .partial();

export const addMemberSchema = z.object({ email: emailSchema, role: z.enum(WORKSPACE_ROLES) });
export const updateMemberSchema = z.object({ role: z.enum(WORKSPACE_ROLES) });
export const transferOwnershipSchema = z.object({ userId: uuidSchema });

// ---------------------------------------------------------------------------
// Projects & columns
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  workspaceId: uuidSchema,
  name: nameSchema,
  key: projectKeySchema,
  description: z.string().max(20000).default(''),
  sprintCapacity: z.number().int().min(1).max(500).optional(),
});

export const updateProjectSchema = z
  .object({
    name: nameSchema,
    description: z.string().max(20000),
    definitionOfReady: z.string().max(10000),
    definitionOfDone: z.string().max(10000),
    notes: z.string().max(100000),
    sprintCapacity: z.number().int().min(1).max(500),
    agentState: z.enum(AGENT_STATES),
    gitMode: z.enum(GIT_MODES),
    baseBranch: branchNameSchema,
  })
  .partial();

export const updateColumnSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    agentRoleId: uuidSchema.nullable(),
    roleSource: z.enum(ROLE_SOURCES),
    wipLimit: z.number().int().min(1).max(100).nullable(),
    color: hexColorSchema.nullable(),
  })
  .partial();

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

const taskFields = {
  type: z.enum(ITEM_TYPES),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(50000),
  acceptanceCriteria: z.string().max(20000),
  priority: z.enum(PRIORITIES),
  storyPoints: storyPointsSchema.nullable(),
  parentId: uuidSchema.nullable(),
  sprintId: uuidSchema.nullable(),
  assignedRoleId: uuidSchema.nullable(),
  assigneeUserId: uuidSchema.nullable(),
  labels: labelsSchema,
  refined: z.boolean(),
  dependsOn: z.array(uuidSchema).max(50),
};

export const createTaskSchema = z.object({
  ...taskFields,
  type: taskFields.type.default('story'),
  description: taskFields.description.default(''),
  acceptanceCriteria: taskFields.acceptanceCriteria.default(''),
  priority: taskFields.priority.default('medium'),
  storyPoints: taskFields.storyPoints.optional(),
  parentId: taskFields.parentId.optional(),
  sprintId: taskFields.sprintId.optional(),
  assignedRoleId: taskFields.assignedRoleId.optional(),
  assigneeUserId: taskFields.assigneeUserId.optional(),
  labels: taskFields.labels.default([]),
  refined: taskFields.refined.default(false),
  dependsOn: taskFields.dependsOn.default([]),
  columnId: uuidSchema.optional(),
});

export const updateTaskSchema = z.object(taskFields).partial();

export const moveTaskSchema = z.object({
  columnId: uuidSchema,
  index: z.number().int().min(0).max(100000),
});

export const createRemarkSchema = z.object({
  body: z.string().trim().min(1).max(20000),
  kind: z.enum(HUMAN_REMARK_KINDS).default('comment'),
  /** When answering a blocked item: move it back to the stage it was blocked from. */
  resume: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

export const createSprintSchema = z.object({
  name: z.string().trim().min(1).max(80),
  goal: z.string().max(2000).default(''),
});
export const updateSprintSchema = z
  .object({ name: z.string().trim().min(1).max(80), goal: z.string().max(2000) })
  .partial();
export const completeSprintSchema = z.object({
  reviewNotes: z.string().max(20000).default(''),
  retroNotes: z.string().max(20000).default(''),
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminCreateUserSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
  role: z.enum(USER_ROLES).default('user'),
});
export const adminUpdateUserSchema = z
  .object({ name: nameSchema, role: z.enum(USER_ROLES), status: z.enum(USER_STATUSES) })
  .partial();
export const adminResetPasswordSchema = z.object({ password: passwordSchema });

export const agentRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lowercase letters, digits and underscores'),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).default(''),
  instructions: z.string().min(1).max(20000),
  color: hexColorSchema.default('#6366f1'),
  enabled: z.boolean().default(true),
  assignable: z.boolean().default(true),
});
export const updateAgentRoleSchema = agentRoleSchema.omit({ key: true }).partial();

export const settingsSchema = z.object({
  general: z.object({
    appName: z.string().trim().min(1).max(60),
    registrationEnabled: z.boolean(),
    defaultSprintCapacity: z.number().int().min(1).max(500),
  }),
  agent: z.object({
    /** Global kill switch: when false, get_next_work never hands out work. */
    enabled: z.boolean(),
    claimTimeoutMinutes: z.number().int().min(5).max(1440),
    /** After this many send-backs (review/QA rejections) an item is escalated to a human. */
    maxBounces: z.number().int().min(1).max(20),
    /** An agent counts as online if it called the MCP server within this window. */
    onlineWindowMinutes: z.number().int().min(1).max(120),
  }),
  security: z.object({
    sessionTtlHours: z.number().int().min(1).max(720),
    maxFailedLogins: z.number().int().min(3).max(20),
    lockoutMinutes: z.number().int().min(1).max(1440),
    passwordMinLength: z.number().int().min(8).max(128),
    tokenMaxDays: z.number().int().min(1).max(365),
  }),
});

export const DEFAULT_SETTINGS: z.infer<typeof settingsSchema> = {
  general: { appName: 'Loop Coder', registrationEnabled: false, defaultSprintCapacity: 20 },
  agent: { enabled: true, claimTimeoutMinutes: 45, maxBounces: 4, onlineWindowMinutes: 10 },
  security: {
    sessionTtlHours: 72,
    maxFailedLogins: 5,
    lockoutMinutes: 15,
    passwordMinLength: 12,
    tokenMaxDays: 90,
  },
};

export const columnKindSchema = z.enum(COLUMN_KINDS);

// Inferred input types
export type LoginInput = z.infer<typeof loginSchema>;
export type SetupInput = z.input<typeof setupSchema>;
export type SetupData = z.output<typeof setupSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateTokenInput = z.input<typeof createTokenSchema>;
export type UpdateTokenInput = z.input<typeof updateTokenSchema>;
export type CreateAiProviderInput = z.input<typeof createAiProviderSchema>;
export type UpdateAiProviderInput = z.input<typeof updateAiProviderSchema>;
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateRemarkInput = z.input<typeof createRemarkSchema>;
export type CreateSprintInput = z.input<typeof createSprintSchema>;
export type AgentRoleInput = z.input<typeof agentRoleSchema>;
export type Settings = z.infer<typeof settingsSchema>;
