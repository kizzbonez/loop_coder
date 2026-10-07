import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FLOW_ACTIONS, type ActivityDTO, type ProjectDetailDTO, type ProjectEvent, type RemarkDTO, type TaskDetailDTO, type TaskDTO } from '@loop/shared';
import { FLOW_HISTORY_LIMIT, keys, upsertTaskInCache } from '../lib/queries';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting';

const MAX_ACTIVITY = 300;
const MAX_LIVE_REMARKS = 50;
const FLOW = new Set<string>(FLOW_ACTIONS);

const prepend = (activity: ActivityDTO, max: number) => (old: ActivityDTO[] | undefined) =>
  old && !old.some((a) => a.id === activity.id) ? [activity, ...old].slice(0, max) : old;

/** Apply one realtime event to the React Query cache. Exported for unit tests. */
export function applyProjectEvent(qc: QueryClient, projectId: string, event: ProjectEvent): void {
  switch (event.type) {
    case 'task.upserted':
      upsertTaskInCache(qc, event.task);
      break;
    case 'task.deleted':
      qc.setQueryData<TaskDTO[]>(keys.tasks(projectId), (old) => old?.filter((t) => t.id !== event.taskId));
      qc.removeQueries({ queryKey: keys.task(event.taskId) });
      break;
    case 'remark.created':
      qc.setQueryData<TaskDetailDTO>(keys.task(event.remark.taskId), (old) =>
        old && !old.remarks.some((r) => r.id === event.remark.id)
          ? { ...old, remarks: [...old.remarks, event.remark], remarkCount: old.remarks.length + 1 }
          : old,
      );
      qc.setQueryData<RemarkDTO[]>(keys.liveRemarks(projectId), (old) =>
        old && !old.some((r) => r.id === event.remark.id) ? [event.remark, ...old].slice(0, MAX_LIVE_REMARKS) : old,
      );
      break;
    case 'project.updated':
      // The event carries the access level of whoever made the change; keep this viewer's own.
      qc.setQueryData<ProjectDetailDTO>(keys.project(projectId), (old) => (old ? { ...old, ...event.project, myAccess: old.myAccess } : old));
      break;
    case 'project.deleted':
      void qc.invalidateQueries({ queryKey: keys.project(projectId) });
      break;
    case 'columns.updated':
      qc.setQueryData<ProjectDetailDTO>(keys.project(projectId), (old) => (old ? { ...old, columns: event.columns } : old));
      break;
    case 'sprint.upserted':
      void qc.invalidateQueries({ queryKey: keys.sprints(projectId) });
      void qc.invalidateQueries({ queryKey: keys.burndown(event.sprint.id) });
      qc.setQueryData<ProjectDetailDTO>(keys.project(projectId), (old) => {
        if (!old) return old;
        if (event.sprint.status === 'active') return { ...old, activeSprint: event.sprint };
        if (old.activeSprint?.id === event.sprint.id) return { ...old, activeSprint: null };
        return old;
      });
      break;
    case 'activity.created':
      qc.setQueryData<ActivityDTO[]>(keys.activity(projectId), prepend(event.activity, MAX_ACTIVITY));
      if (FLOW.has(event.activity.action)) qc.setQueryData<ActivityDTO[]>(keys.flow(projectId), prepend(event.activity, FLOW_HISTORY_LIMIT));
      break;
    case 'agent.presence':
      qc.setQueryData<ProjectDetailDTO>(keys.project(projectId), (old) => (old ? { ...old, agent: event.agent, agents: event.agents } : old));
      break;
  }
}

/**
 * Subscribes to the project's Server-Sent Events stream and keeps the cache live.
 * After a reconnect everything is re-fetched so no change is missed.
 */
export function useProjectStream(projectId: string): StreamStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    if (!projectId) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disconnected = false;
    let closed = false;

    const connect = () => {
      source = new EventSource(`/api/projects/${projectId}/events`);
      source.addEventListener('hello', () => {
        setStatus('live');
        if (disconnected) {
          disconnected = false;
          void qc.invalidateQueries({ queryKey: ['project', projectId] });
        }
      });
      source.onmessage = (message) => {
        try {
          applyProjectEvent(qc, projectId, JSON.parse(message.data) as ProjectEvent);
        } catch {
          /* ignore malformed events */
        }
      };
      source.onerror = () => {
        disconnected = true;
        setStatus('reconnecting');
        // The browser retries on its own unless the server answered with an error status.
        if (source?.readyState === EventSource.CLOSED && !closed) {
          retry = setTimeout(connect, 5000);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [projectId, qc]);

  return status;
}
