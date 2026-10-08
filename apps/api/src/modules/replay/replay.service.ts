import { and, asc, desc, eq, gte, isNotNull, lte, min, ne, sql } from 'drizzle-orm';
import type { PresenceEntryDTO, RemarkDTO, ReplayDTO, ReplaySegmentDTO } from '@loop/shared';
import { db } from '../../db/client';
import { activities, agentPresenceLog, projects, sprints, taskRemarks, users } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { notFound } from '../../lib/errors';
import { activityToDTO } from '../activity/activity.service';
import { requireProjectAccess } from '../projects/access';
import { getSettings } from '../settings/settings.service';
import { toRemarkDTO } from '../tasks/tasks.query';

/** Size limits per replay: generous for real projects, bounded for runaway ones. */
export const REPLAY_LIMITS = { events: 20_000, remarks: 5_000, presence: 50_000, remarkChars: 600 } as const;

const iso = (d: Date) => d.toISOString();

/**
 * The parts of a project's history: the whole project, the kickoff, each started sprint and, after
 * the last one, the time since. They follow each other without gaps: a sprint runs from the end of
 * the one before (or of the kickoff) until it completes, so its refinement, planning and review
 * belong to it.
 */
export function replaySegments(projectId: string): ReplaySegmentDTO[] {
  const project = db
    .select({ createdAt: projects.createdAt, kickoffCompletedAt: projects.kickoffCompletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw notFound('Project not found');
  const start = project.createdAt;
  const segments: ReplaySegmentDTO[] = [
    { id: 'all', label: 'Whole project', detail: null, from: iso(start), to: null },
    { id: 'kickoff', label: 'Kickoff', detail: null, from: iso(start), to: project.kickoffCompletedAt ? iso(project.kickoffCompletedAt) : null },
  ];
  if (!project.kickoffCompletedAt) return segments;

  let boundary = project.kickoffCompletedAt;
  let after = 'the kickoff';
  const started = db
    .select()
    .from(sprints)
    .where(and(eq(sprints.projectId, projectId), isNotNull(sprints.startedAt)))
    .orderBy(asc(sprints.number))
    .all();
  for (const s of started) {
    segments.push({ id: `sprint-${s.number}`, label: s.name, detail: s.goal || null, from: iso(boundary), to: s.completedAt ? iso(s.completedAt) : null });
    if (!s.completedAt) return segments; // the active sprint runs until now
    boundary = s.completedAt;
    after = s.name;
  }
  // Refinement and planning after the last sprint (or the kickoff), if anything happened since.
  const since = db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.projectId, projectId), gte(activities.createdAt, new Date(boundary.getTime() + 1))))
    .limit(1)
    .get();
  if (since) segments.push({ id: 'latest', label: `Since ${after}`, detail: null, from: iso(boundary), to: null });
  return segments;
}

/** Everything the Flow and Office views need to replay one segment as it happened. */
export function getReplay(actor: Actor, projectId: string, segmentId: string | undefined): ReplayDTO {
  requireProjectAccess(actor, projectId, 'viewer');
  const segments = replaySegments(projectId);
  const segment = segments.find((s) => s.id === segmentId) ?? segments[0]!;
  const from = new Date(segment.from);
  const to = segment.to ? new Date(segment.to) : null;
  const window = getSettings().agent.onlineWindowMinutes;

  // Newest first, like the activity feed: the client sorts them stably by time.
  const eventRows = db
    .select({ row: activities, actorName: users.name })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorUserId))
    .where(and(eq(activities.projectId, projectId), gte(activities.createdAt, from)))
    .orderBy(desc(activities.createdAt), sql`activities.rowid desc`)
    .limit(REPLAY_LIMITS.events + 1)
    .all();

  const remarkRows = db
    .select({ remark: taskRemarks, authorName: users.name })
    .from(taskRemarks)
    .leftJoin(users, eq(users.id, taskRemarks.authorUserId))
    .where(
      and(
        eq(taskRemarks.projectId, projectId),
        ne(taskRemarks.kind, 'system'),
        gte(taskRemarks.createdAt, from),
        to ? lte(taskRemarks.createdAt, to) : undefined,
      ),
    )
    .orderBy(asc(taskRemarks.createdAt), sql`task_remarks.rowid asc`)
    .limit(REPLAY_LIMITS.remarks + 1)
    .all();

  // Rows from the online window before the start tell who was already there when it begins.
  const presenceRows = db
    .select()
    .from(agentPresenceLog)
    .where(
      and(
        eq(agentPresenceLog.projectId, projectId),
        gte(agentPresenceLog.at, new Date(from.getTime() - window * 60_000)),
        to ? lte(agentPresenceLog.at, to) : undefined,
      ),
    )
    .orderBy(asc(agentPresenceLog.at), sql`agent_presence_log.rowid asc`)
    .limit(REPLAY_LIMITS.presence + 1)
    .all();
  const firstPresence = db
    .select({ at: min(agentPresenceLog.at) })
    .from(agentPresenceLog)
    .where(eq(agentPresenceLog.projectId, projectId))
    .get();

  const remarks: RemarkDTO[] = remarkRows.slice(0, REPLAY_LIMITS.remarks).map(({ remark, authorName }) => {
    const dto = toRemarkDTO(remark, authorName);
    return dto.body.length > REPLAY_LIMITS.remarkChars ? { ...dto, body: `${dto.body.slice(0, REPLAY_LIMITS.remarkChars)}…` } : dto;
  });
  const presence: PresenceEntryDTO[] = presenceRows.slice(0, REPLAY_LIMITS.presence).map((p) => ({
    sessionId: p.sessionId,
    agentName: p.agentName,
    userName: p.userName,
    at: iso(p.at),
    taskId: p.taskId,
    taskKey: p.taskKey,
    roleKey: p.roleKey,
    ceremony: p.ceremony,
    activity: p.activity,
  }));
  // firstPresence.at comes back as a raw number from the aggregate.
  const since = firstPresence?.at != null ? new Date(firstPresence.at as unknown as number | Date) : null;

  return {
    segments,
    segment,
    events: eventRows.slice(0, REPLAY_LIMITS.events).map(({ row, actorName }) => activityToDTO(row, actorName)),
    remarks,
    presence,
    presenceSince: since ? iso(since) : null,
    onlineWindowMinutes: window,
    truncated:
      eventRows.length > REPLAY_LIMITS.events || remarkRows.length > REPLAY_LIMITS.remarks || presenceRows.length > REPLAY_LIMITS.presence,
  };
}
