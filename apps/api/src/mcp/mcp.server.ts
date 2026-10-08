import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  createTaskSchema,
  formatTaskKey,
  ITEM_TYPES,
  CEREMONY_LABELS,
  MCP_SERVER_NAME,
  PRIORITIES,
  REMARK_KINDS,
  STORY_POINTS,
  updateTaskSchema,
} from '@loop/shared';
import { versionInfo } from '../config/version';
import { db } from '../db/client';
import { projects, workspaces, type ProjectRow } from '../db/schema';
import type { Actor } from '../lib/actor';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { isUuid } from '../lib/http';
import { EventBatch } from '../realtime/bus';
import { getProjectAccess, requireProjectAccess } from '../modules/projects/access';
import { listProjects } from '../modules/projects/projects.service';
import { columnByKind, getColumns, getProjectByKey, getProjectRow } from '../modules/projects/projects.query';
import { touchPresence, type PresenceUpdate } from '../modules/presence/presence.service';
import { getRoleByKey, listRoles } from '../modules/roles/roles.service';
import { getActiveSprintDTO } from '../modules/sprints/sprints.query';
import { getTaskDTO, listProjectTaskDTOs, listRemarks, resolveTaskRef } from '../modules/tasks/tasks.query';
import { applyTaskUpdate, insertTask } from '../modules/tasks/tasks.service';
import { WORK_LOOP_PROMPT } from '../modules/workflow/instructions';
import {
  addAgentRemark,
  boardSummary,
  completeKickoff,
  completeSprintFromReview,
  DEFAULT_WAIT_SECONDS,
  getNextWork,
  logProgress,
  markRefined,
  moveWorkItem,
  releaseWorkItem,
  requestHumanInput,
  MAX_WAIT_SECONDS,
  startSprintFromPlanning,
  updateProjectNotes,
  waitForWork,
  type NoWorkStatus,
  type WorkPackage,
} from '../modules/workflow/workflow.service';
import { formatTaskDetail, formatTaskRow } from './mcp.format';

const SERVER_INSTRUCTIONS = `Loop Coder is an Agile/Scrum Kanban board you work through as a full delivery team.
Start with get_next_work for a project; it tells you which role to play and exactly what to do. Finish each step with the tool it names, then call get_next_work again. Humans watch the board live: when they pause you, call wait_for_work until they resume; when they stop you, end your session.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ok = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });

function fail(err: unknown): CallToolResult {
  if (err instanceof HttpError) {
    const details = Array.isArray(err.details)
      ? `\n${(err.details as Array<{ path: string; message: string }>).map((d) => `- ${d.path}: ${d.message}`).join('\n')}`
      : '';
    return { content: [{ type: 'text', text: `Error: ${err.message}${details}` }], isError: true };
  }
  if (err instanceof z.ZodError) {
    const details = err.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    return { content: [{ type: 'text', text: `Error: invalid input\n${details}` }], isError: true };
  }
  throw err;
}

/** What the agent does next when there is no work, appended to the reason. */
const NEXT_STEP: Record<NoWorkStatus, string> = {
  paused: 'Do not end your session: call `wait_for_work` and keep calling it while it reports PAUSED. It returns the next work as soon as the project is resumed.',
  waiting: 'Do not end your session: call `wait_for_work` and keep calling it while it reports WAITING. It returns as soon as a human answers or work frees up.',
  stopped: 'End your session now: call no more tools for this project and summarise what you did. A human restarts you when there is more to do.',
  complete: 'End your session and summarise what you did.',
  disabled: 'End your session and summarise what you did.',
};

function run(fn: () => string): CallToolResult {
  try {
    return ok(fn());
  } catch (err) {
    return fail(err);
  }
}

const projectArg = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe('Project key (e.g. "SHOP") or id. Optional when the token is scoped to one project.');
const itemArg = z.string().min(1).max(64).describe('Work item key (e.g. "SHOP-12") or id');

function resolveProject(actor: Actor, ref: string | undefined, min: 'viewer' | 'editor' = 'viewer'): ProjectRow {
  let project: ProjectRow | undefined;
  if (ref) {
    project = isUuid(ref) ? db.select().from(projects).where(eq(projects.id, ref.toLowerCase())).get() : getProjectByKey(ref);
    if (!project) throw notFound(`Project "${ref}"`);
  } else if (actor.tokenProjectId) {
    project = getProjectRow(actor.tokenProjectId);
  } else {
    throw badRequest('Pass the `project` key (for example "SHOP"). Call list_projects to see the projects you can access.');
  }
  requireProjectAccess(actor, project.id, min);
  return project;
}

function keyIndex(projectId: string): Map<string, { key: string; done: boolean }> {
  const done = columnByKind(getColumns(projectId), 'done');
  return new Map(listProjectTaskDTOs(projectId).map((t) => [t.id, { key: t.key, done: t.columnId === done.id }]));
}

function roleIdByKey(key: string | null | undefined): string | null | undefined {
  if (key === undefined) return undefined;
  if (key === null || key === '') return null;
  const role = getRoleByKey(key);
  if (!role || !role.enabled) {
    const valid = listRoles()
      .filter((r) => r.enabled && r.assignable)
      .map((r) => r.key)
      .join(', ');
    throw badRequest(`Unknown role "${key}". Assignable roles: ${valid}`);
  }
  return role.id;
}

const storyPointsArg = z
  .number()
  .int()
  .refine((n) => (STORY_POINTS as readonly number[]).includes(n), 'Use 0, 1, 2, 3, 5, 8, 13 or 21')
  .describe('Story points on the Fibonacci scale');

// ---------------------------------------------------------------------------
// Server factory (one per request: the transport is stateless)
// ---------------------------------------------------------------------------

export function buildMcpServer(actor: Actor): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: 'Loop Coder', version: versionInfo.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const touch = (projectId: string, update: PresenceUpdate = {}) => touchPresence(actor, projectId, update);

  // --- Discovery --------------------------------------------------------------

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List the projects (and their workspaces) this token can work on, with progress and agent state.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(() => {
        const list = listProjects(actor).filter((p) => !actor.tokenProjectId || p.id === actor.tokenProjectId);
        if (list.length === 0) return 'No projects are accessible with this token.';
        return list
          .map(
            (p) =>
              `- **${p.key}** ${p.name} (workspace: ${p.workspaceName}) · agent ${p.agentState} · ${p.stats.done}/${p.stats.total} items done · ${p.kickoffCompletedAt ? 'kickoff done' : 'kickoff pending'} · folder \`${p.workspacePath}\``,
          )
          .join('\n');
      }),
  );

  server.registerTool(
    'get_project_context',
    {
      title: 'Get project context',
      description:
        'Goal, Definition of Ready/Done, shared project notes, board summary, active sprint and available roles for a project.',
      inputSchema: { project: projectArg },
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(() => {
        const p = resolveProject(actor, project);
        const ws = db.select().from(workspaces).where(eq(workspaces.id, p.workspaceId)).get()!;
        const sprint = getActiveSprintDTO(p.id);
        const roles = listRoles().filter((r) => r.enabled);
        touch(p.id);
        return [
          `# ${p.name} (${p.key})`,
          `Workspace: ${ws.name} · Repository folder: \`${ws.slug}/${p.key.toLowerCase()}\` · Agent: ${p.agentState}`,
          `## Goal / requirements\n${p.description || '_none_'}`,
          `## Board\n${boardSummary(p.id)}`,
          `## Active sprint\n${sprint ? `${sprint.name}: ${sprint.goal} (${sprint.stats.done}/${sprint.stats.total} done, ${sprint.stats.donePoints}/${sprint.stats.points} pts)` : '_none_'}`,
          `## Definition of Ready\n${p.definitionOfReady}`,
          `## Definition of Done\n${p.definitionOfDone}`,
          `## Project notes\n${p.notes || '_empty_'}`,
          `## Roles\n${roles.map((r) => `- \`${r.key}\`: ${r.name}. ${r.description}${r.assignable ? '' : ' (stage role, not assignable)'}`).join('\n')}`,
        ].join('\n\n');
      }),
  );

  // --- The loop ---------------------------------------------------------------

  /** Shows the agent what it got: instructions for work, or the status and what to do next. */
  const present = (projectId: string, pkg: WorkPackage): string => {
    if (pkg.kind === 'task') {
      touch(projectId, { taskId: pkg.task.id, roleKey: pkg.role.key, ceremony: null, activity: `Working on ${pkg.task.key} as ${pkg.role.name}` });
      const detail = formatTaskDetail(pkg.task, {
        columnName: pkg.column.name,
        roleName: pkg.role.name,
        keyById: keyIndex(projectId),
      });
      return `${pkg.instructions}\n\n${detail}`;
    }
    if (pkg.kind === 'ceremony') {
      const label = CEREMONY_LABELS[pkg.ceremony];
      touch(projectId, { taskId: null, roleKey: pkg.role.key, ceremony: pkg.ceremony, activity: `${label} as ${pkg.role.name}` });
      return pkg.instructions;
    }
    touch(projectId, { taskId: null, roleKey: null, ceremony: null, activity: pkg.message });
    return `STATUS: ${pkg.status.toUpperCase()}\n${pkg.message}\n${NEXT_STEP[pkg.status]}`;
  };

  server.registerTool(
    'get_next_work',
    {
      title: 'Get next work',
      description:
        'Claim the next piece of work for a project (a work item or a Scrum ceremony) together with the role to play and step-by-step instructions. Call this in a loop.',
      inputSchema: { project: projectArg },
    },
    ({ project }) =>
      run(() => {
        const p = resolveProject(actor, project, 'editor');
        return present(p.id, getNextWork(actor, p.id));
      }),
  );

  server.registerTool(
    'wait_for_work',
    {
      title: 'Wait for work',
      description: `Call when get_next_work reports PAUSED or WAITING. Waits up to \`seconds\` (default ${DEFAULT_WAIT_SECONDS}, at most ${MAX_WAIT_SECONDS}) for a human to resume the project, answer a question or free up work, and returns the next work as soon as there is some, exactly like get_next_work. If it still reports PAUSED or WAITING, call it again. It returns STOPPED at once when a human stops you.`,
      inputSchema: {
        project: projectArg,
        seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional().describe(`How long to wait at most (default ${DEFAULT_WAIT_SECONDS})`),
      },
    },
    async ({ project, seconds }, extra) => {
      try {
        const p = resolveProject(actor, project, 'editor');
        const pkg = await waitForWork(actor, p.id, { maxWaitMs: (seconds ?? DEFAULT_WAIT_SECONDS) * 1000, signal: extra.signal });
        return ok(present(p.id, pkg));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- Work items ---------------------------------------------------------------

  server.registerTool(
    'get_work_item',
    {
      title: 'Get work item',
      description: 'Full details of a work item including its acceptance criteria and remark thread.',
      inputSchema: { item: itemArg },
      annotations: { readOnlyHint: true },
    },
    ({ item }) =>
      run(() => {
        const task = resolveTaskRef(item, actor.tokenProjectId ?? undefined);
        requireProjectAccess(actor, task.projectId, 'viewer');
        const dto = getTaskDTO(db, task.id);
        const column = getColumns(task.projectId).find((c) => c.id === task.columnId)!;
        touch(task.projectId);
        return formatTaskDetail({ ...dto, remarks: listRemarks(task.id) }, { columnName: column.name, keyById: keyIndex(task.projectId) });
      }),
  );

  server.registerTool(
    'list_work_items',
    {
      title: 'List work items',
      description: 'List work items of a project, optionally filtered by column kind, type or the active sprint.',
      inputSchema: {
        project: projectArg,
        column: z
          .enum(['backlog', 'todo', 'in_progress', 'review', 'testing', 'blocked', 'done'])
          .optional()
          .describe('Only items in this stage'),
        type: z.enum(ITEM_TYPES).optional(),
        active_sprint_only: z.boolean().optional().describe('Only items committed to the running sprint'),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ project, column, type, active_sprint_only, limit }) =>
      run(() => {
        const p = resolveProject(actor, project);
        const columns = getColumns(p.id);
        const names = new Map(columns.map((c) => [c.id, c.name]));
        const kindOf = new Map(columns.map((c) => [c.id, c.kind]));
        const sprint = active_sprint_only ? getActiveSprintDTO(p.id) : null;
        const rows = listProjectTaskDTOs(p.id)
          .filter((t) => !column || kindOf.get(t.columnId) === column)
          .filter((t) => !type || t.type === type)
          .filter((t) => !active_sprint_only || (sprint && t.sprintId === sprint.id))
          .sort((a, b) => a.number - b.number)
          .slice(0, limit ?? 200);
        touch(p.id);
        return rows.length ? rows.map((t) => formatTaskRow(t, names.get(t.columnId) ?? '?')).join('\n') : 'No matching work items.';
      }),
  );

  const newItemShape = z.object({
    ref: z
      .string()
      .max(40)
      .optional()
      .describe('Temporary reference so other items in the same call can point to this one as parent or dependency'),
    type: z.enum(ITEM_TYPES).default('story'),
    title: z.string().min(1).max(200),
    description: z.string().max(50000).optional(),
    acceptance_criteria: z.string().max(20000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    story_points: storyPointsArg.optional(),
    parent: z.string().optional().describe('Parent epic: ref from this call or an existing key'),
    depends_on: z.array(z.string()).max(20).optional().describe('Refs from this call or existing keys'),
    assigned_role: z.string().optional().describe('Role key that implements it, e.g. backend_developer, frontend_developer, senior_developer, ui_designer, architect'),
    labels: z.array(z.string().max(30)).max(10).optional(),
    refined: z.boolean().optional().describe('True only when the item already meets the Definition of Ready'),
  });

  server.registerTool(
    'create_work_items',
    {
      title: 'Create work items',
      description:
        'Create one or more backlog items (epics, stories, tasks, bugs, spikes). Items can reference each other through `ref` for parent epics and dependencies.',
      inputSchema: { project: projectArg, items: z.array(newItemShape).min(1).max(50) },
    },
    ({ project, items }) =>
      run(() => {
        const p = resolveProject(actor, project, 'editor');
        const batch = new EventBatch();
        const created = db.transaction((tx) => {
          const refMap = new Map<string, string>();
          const resolve = (ref: string) => refMap.get(ref) ?? resolveTaskRef(ref, p.id, tx).id;
          const rows = items.map((item) => {
            const data = createTaskSchema.parse({
              type: item.type,
              title: item.title,
              description: item.description ?? '',
              acceptanceCriteria: item.acceptance_criteria ?? '',
              priority: item.priority ?? 'medium',
              storyPoints: item.story_points ?? null,
              labels: item.labels ?? [],
              refined: item.refined ?? false,
              assignedRoleId: roleIdByKey(item.assigned_role) ?? null,
            });
            const row = insertTask(tx, batch, actor, p.id, data);
            if (item.ref) refMap.set(item.ref, row.id);
            return row;
          });
          items.forEach((item, i) => {
            const patch: { parentId?: string; dependsOn?: string[] } = {};
            if (item.parent) patch.parentId = resolve(item.parent);
            if (item.depends_on?.length) patch.dependsOn = item.depends_on.map(resolve);
            if (Object.keys(patch).length) applyTaskUpdate(tx, batch, actor, rows[i]!, patch, null, true);
          });
          return rows.map((r, i) => `${items[i]!.ref ? `${items[i]!.ref} → ` : ''}${formatTaskKey(p.key, r.number)} ${r.title}`);
        });
        batch.flush();
        touch(p.id, { activity: `Created ${created.length} work item(s)` });
        return `Created ${created.length} item(s):\n${created.map((c) => `- ${c}`).join('\n')}`;
      }),
  );

  server.registerTool(
    'update_work_item',
    {
      title: 'Update work item',
      description: 'Edit fields of a work item. Omitted fields stay unchanged. `depends_on` replaces the whole list.',
      inputSchema: {
        item: itemArg,
        title: z.string().min(1).max(200).optional(),
        type: z.enum(ITEM_TYPES).optional(),
        description: z.string().max(50000).optional(),
        acceptance_criteria: z.string().max(20000).optional(),
        priority: z.enum(PRIORITIES).optional(),
        story_points: storyPointsArg.nullable().optional(),
        assigned_role: z.string().nullable().optional(),
        parent: z.string().nullable().optional().describe('Parent epic key, or null to detach'),
        depends_on: z.array(z.string()).max(20).optional(),
        labels: z.array(z.string().max(30)).max(10).optional(),
      },
    },
    (args) =>
      run(() => {
        const task = resolveTaskRef(args.item, actor.tokenProjectId ?? undefined);
        requireProjectAccess(actor, task.projectId, 'editor');
        const patch = updateTaskSchema.parse({
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.type !== undefined ? { type: args.type } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.acceptance_criteria !== undefined ? { acceptanceCriteria: args.acceptance_criteria } : {}),
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          ...(args.story_points !== undefined ? { storyPoints: args.story_points } : {}),
          ...(args.assigned_role !== undefined ? { assignedRoleId: roleIdByKey(args.assigned_role) } : {}),
          ...(args.parent !== undefined
            ? { parentId: args.parent ? resolveTaskRef(args.parent, task.projectId).id : null }
            : {}),
          ...(args.depends_on !== undefined
            ? { dependsOn: args.depends_on.map((r) => resolveTaskRef(r, task.projectId).id) }
            : {}),
          ...(args.labels !== undefined ? { labels: args.labels } : {}),
        });
        if (Object.keys(patch).length === 0) return 'Nothing to update.';
        const batch = new EventBatch();
        db.transaction((tx) => applyTaskUpdate(tx, batch, actor, task, patch, task.claimRoleKey));
        batch.flush();
        const dto = getTaskDTO(db, task.id);
        touch(task.projectId, { activity: `Updated ${dto.key}` });
        return `Updated ${dto.key}: ${Object.keys(patch).join(', ')}`;
      }),
  );

  server.registerTool(
    'add_remark',
    {
      title: 'Add remark',
      description: 'Add a remark to a work item: progress log, design notes, review, test report or a comment.',
      inputSchema: {
        item: itemArg,
        body: z.string().min(1).max(20000).describe('Markdown'),
        kind: z.enum(REMARK_KINDS).exclude(['system', 'answer']).default('work_log'),
      },
    },
    ({ item, body, kind }) =>
      run(() => {
        const r = addAgentRemark(actor, item, body, kind, actor.tokenProjectId ?? undefined);
        touch(r.projectId, { activity: `Wrote a ${kind.replace('_', ' ')} on ${r.taskKey}` });
        return `Remark added to ${r.taskKey}.`;
      }),
  );

  server.registerTool(
    'move_work_item',
    {
      title: 'Move work item',
      description:
        'Hand a work item to the next stage (or send it back for rework) with a remark explaining the outcome. Columns: backlog, todo, in_progress, review, testing, done.',
      inputSchema: {
        item: itemArg,
        to: z.string().min(1).max(40).describe('Target column kind, e.g. "review", "testing", "done", "in_progress"'),
        remark: z.string().min(1).max(20000).describe('What was done / decided, in markdown'),
        kind: z.enum(['work_log', 'design', 'review', 'test_report', 'comment']).default('work_log'),
      },
    },
    ({ item, to, remark, kind }) =>
      run(() => {
        const r = moveWorkItem(actor, item, to, { body: remark, kind }, actor.tokenProjectId ?? undefined);
        touch(r.projectId, { taskId: null, activity: `Moved ${r.taskKey} to ${r.column.name}`, completedItem: r.column.kind === 'done' });
        return r.escalated
          ? `${r.taskKey} exceeded the rework limit and was escalated to "${r.column.name}" for a human decision. Continue with get_next_work.`
          : `${r.taskKey} moved to "${r.column.name}". Continue with get_next_work.`;
      }),
  );

  server.registerTool(
    'mark_refined',
    {
      title: 'Mark refined',
      description: 'Finish backlog refinement: the item meets the Definition of Ready and can be planned into a sprint.',
      inputSchema: { item: itemArg, summary: z.string().min(1).max(5000) },
    },
    ({ item, summary }) =>
      run(() => {
        const r = markRefined(actor, item, summary, actor.tokenProjectId ?? undefined);
        touch(r.projectId, { taskId: null, activity: `Refined ${r.taskKey}` });
        return `${r.taskKey} is refined and ready for sprint planning. Continue with get_next_work.`;
      }),
  );

  server.registerTool(
    'request_human_input',
    {
      title: 'Request human input',
      description:
        'Escalate a work item to a human with a precise question. It moves to "Needs Human" until someone answers on the board.',
      inputSchema: { item: itemArg, question: z.string().min(1).max(5000) },
    },
    ({ item, question }) =>
      run(() => {
        const r = requestHumanInput(actor, item, question, actor.tokenProjectId ?? undefined);
        touch(r.projectId, { taskId: null, activity: `Asked a human about ${r.taskKey}` });
        return `${r.taskKey} is waiting for a human answer. Continue with get_next_work for other work.`;
      }),
  );

  server.registerTool(
    'release_work_item',
    {
      title: 'Release work item',
      description: 'Give up your claim on a work item without moving it (for example when you must stop mid-way).',
      inputSchema: { item: itemArg, note: z.string().max(5000).optional() },
    },
    ({ item, note }) =>
      run(() => {
        const r = releaseWorkItem(actor, item, note, actor.tokenProjectId ?? undefined);
        touch(r.projectId, { taskId: null, activity: `Released ${r.taskKey}` });
        return `Released ${r.taskKey}.`;
      }),
  );

  server.registerTool(
    'log_progress',
    {
      title: 'Log progress',
      description: 'Post a short live progress note to the board (e.g. "Running the test suite"). Also keeps your claim alive.',
      inputSchema: { project: projectArg, message: z.string().min(1).max(300), item: itemArg.optional() },
    },
    ({ project, message, item }) =>
      run(() => {
        const p = resolveProject(actor, project, 'editor');
        const r = logProgress(actor, p.id, message, item);
        touch(p.id, { activity: message, ...(r.taskId ? { taskId: r.taskId } : {}) });
        return 'Logged.';
      }),
  );

  // --- Ceremonies ---------------------------------------------------------------

  server.registerTool(
    'complete_kickoff',
    {
      title: 'Complete kickoff',
      description: 'Finish the project kickoff after the initial backlog and project notes are in place.',
      inputSchema: { project: projectArg, summary: z.string().min(1).max(2000) },
    },
    ({ project, summary }) =>
      run(() => {
        const p = resolveProject(actor, project, 'editor');
        completeKickoff(actor, p.id, summary);
        touch(p.id, { taskId: null, ceremony: null, activity: 'Completed the project kickoff' });
        return 'Kickoff complete. Continue with get_next_work.';
      }),
  );

  server.registerTool(
    'start_sprint',
    {
      title: 'Start sprint',
      description: 'Sprint planning outcome: create and start a sprint with a goal and the committed, refined backlog items.',
      inputSchema: {
        project: projectArg,
        goal: z.string().min(1).max(2000),
        items: z.array(z.string()).min(1).max(100).describe('Keys of refined backlog items to commit'),
        name: z.string().max(80).optional(),
      },
    },
    ({ project, goal, items, name }) =>
      run(() => {
        const p = resolveProject(actor, project, 'editor');
        const r = startSprintFromPlanning(actor, p.id, { goal, items, name });
        touch(p.id, { taskId: null, ceremony: null, activity: `Started ${r.sprintName}` });
        const warning = r.points > r.capacity ? `\nWarning: ${r.points} points committed exceeds the capacity of ${r.capacity}.` : '';
        return `${r.sprintName} started with ${r.committed.length} item(s), ${r.points} points: ${r.committed.join(', ')}.${warning}\nContinue with get_next_work.`;
      }),
  );

  server.registerTool(
    'complete_sprint',
    {
      title: 'Complete sprint',
      description: 'Sprint review and retrospective outcome: close the active sprint with review and retrospective notes.',
      inputSchema: {
        project: projectArg,
        review_notes: z.string().min(1).max(20000),
        retro_notes: z.string().min(1).max(20000),
      },
    },
    ({ project, review_notes, retro_notes }) =>
      run(() => {
        const p = resolveProject(actor, project, 'editor');
        const r = completeSprintFromReview(actor, p.id, { reviewNotes: review_notes, retroNotes: retro_notes });
        touch(p.id, { taskId: null, ceremony: null, activity: `Completed ${r.sprintName}` });
        return `${r.sprintName} completed (${r.done}/${r.total} items done). Continue with get_next_work.`;
      }),
  );

  server.registerTool(
    'update_project_notes',
    {
      title: 'Update project notes',
      description: 'Shared project memory (decisions, conventions, assumptions, lessons). Append a dated entry or replace everything.',
      inputSchema: {
        project: projectArg,
        text: z.string().min(1).max(50000),
        mode: z.enum(['append', 'replace']).default('append'),
      },
    },
    ({ project, text, mode }) =>
      run(() => {
        const p = resolveProject(actor, project, 'editor');
        const size = updateProjectNotes(actor, p.id, text, mode);
        touch(p.id, { activity: 'Updated the project notes' });
        return `Project notes saved (${size} characters).`;
      }),
  );

  // --- Prompts (slash commands in clients that support MCP prompts, e.g. Claude Code) ---

  server.registerPrompt(
    'work',
    {
      title: 'Work the board',
      description: 'Start the autonomous delivery loop for a project.',
      argsSchema: { project: z.string().describe('Project key, e.g. SHOP') },
    },
    ({ project }) => {
      const found = getProjectByKey(project);
      const p = found && getProjectAccess(actor, found.id) ? found : undefined;
      const ws = p ? db.select().from(workspaces).where(eq(workspaces.id, p.workspaceId)).get() : undefined;
      const path = p && ws ? `${ws.slug}/${p.key.toLowerCase()}` : project.toLowerCase();
      return {
        messages: [{ role: 'user', content: { type: 'text', text: WORK_LOOP_PROMPT(project.toUpperCase(), path) } }],
      };
    },
  );

  return server;
}
