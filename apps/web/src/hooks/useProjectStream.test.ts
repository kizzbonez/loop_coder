import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityDTO, ProjectDetailDTO, RemarkDTO, TaskDetailDTO, TaskDTO } from '@loop/shared';
import { keys } from '../lib/queries';
import { applyProjectEvent } from './useProjectStream';

const P = 'project-1';
const baseTask = { id: 't1', projectId: P, title: 'A', columnId: 'c1', position: 1 } as TaskDTO;
let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient();
  qc.setQueryData(keys.tasks(P), [baseTask]);
  qc.setQueryData(keys.project(P), {
    id: P,
    name: 'Shop',
    columns: [],
    activeSprint: null,
    agent: { online: false },
    myAccess: 'viewer',
  } as unknown as ProjectDetailDTO);
});

describe('applyProjectEvent', () => {
  it('upserts work items into the board cache', () => {
    applyProjectEvent(qc, P, { type: 'task.upserted', task: { ...baseTask, title: 'Renamed' } });
    applyProjectEvent(qc, P, { type: 'task.upserted', task: { ...baseTask, id: 't2', title: 'New' } });
    const tasks = qc.getQueryData<TaskDTO[]>(keys.tasks(P))!;
    expect(tasks.map((t) => t.title)).toEqual(['Renamed', 'New']);
  });

  it('keeps remarks when a work item detail is updated', () => {
    qc.setQueryData(keys.task('t1'), { ...baseTask, remarks: [{ id: 'r1' }] } as TaskDetailDTO);
    applyProjectEvent(qc, P, { type: 'task.upserted', task: { ...baseTask, title: 'X' } });
    const detail = qc.getQueryData<TaskDetailDTO>(keys.task('t1'))!;
    expect(detail.title).toBe('X');
    expect(detail.remarks).toHaveLength(1);
  });

  it('removes deleted items', () => {
    applyProjectEvent(qc, P, { type: 'task.deleted', taskId: 't1' });
    expect(qc.getQueryData<TaskDTO[]>(keys.tasks(P))).toEqual([]);
  });

  it('appends new remarks once (idempotent)', () => {
    qc.setQueryData(keys.task('t1'), { ...baseTask, remarks: [] } as unknown as TaskDetailDTO);
    const remark = { id: 'r9', taskId: 't1', body: 'hi' } as RemarkDTO;
    applyProjectEvent(qc, P, { type: 'remark.created', remark });
    applyProjectEvent(qc, P, { type: 'remark.created', remark });
    expect(qc.getQueryData<TaskDetailDTO>(keys.task('t1'))!.remarks).toHaveLength(1);
  });

  it('prepends activity without duplicates', () => {
    qc.setQueryData(keys.activity(P), [{ id: 'a1' }] as ActivityDTO[]);
    const activity = { id: 'a2', message: 'moved' } as ActivityDTO;
    applyProjectEvent(qc, P, { type: 'activity.created', activity });
    applyProjectEvent(qc, P, { type: 'activity.created', activity });
    expect(qc.getQueryData<ActivityDTO[]>(keys.activity(P))!.map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('keeps the flow history live with flow events only', () => {
    qc.setQueryData(keys.flow(P), [{ id: 'f1', action: 'task.moved' }] as ActivityDTO[]);
    applyProjectEvent(qc, P, { type: 'activity.created', activity: { id: 'f2', action: 'task.moved' } as ActivityDTO });
    applyProjectEvent(qc, P, { type: 'activity.created', activity: { id: 'f2', action: 'task.moved' } as ActivityDTO });
    applyProjectEvent(qc, P, { type: 'activity.created', activity: { id: 'x', action: 'remark.created' } as ActivityDTO });
    expect(qc.getQueryData<ActivityDTO[]>(keys.flow(P))!.map((a) => a.id)).toEqual(['f2', 'f1']);
  });

  it('updates agent presence, project fields and columns', () => {
    const agents = [{ id: 's1', agentName: 'Cursor' }] as ProjectDetailDTO['agents'];
    applyProjectEvent(qc, P, { type: 'agent.presence', agent: { online: true, currentActivity: 'Testing' } as ProjectDetailDTO['agent'], agents });
    applyProjectEvent(qc, P, { type: 'project.updated', project: { agentState: 'paused', myAccess: 'owner' } as ProjectDetailDTO });
    applyProjectEvent(qc, P, { type: 'columns.updated', columns: [{ id: 'c1' }] as ProjectDetailDTO['columns'] });
    const project = qc.getQueryData<ProjectDetailDTO>(keys.project(P))!;
    expect(project.agent.online).toBe(true);
    expect(project.agents).toEqual(agents);
    expect(project.agentState).toBe('paused');
    expect(project.columns).toHaveLength(1);
    expect(project.name).toBe('Shop');
    expect(project.myAccess).toBe('viewer'); // never the access level of whoever changed it
  });

  it('tracks the active sprint', () => {
    const sprint = { id: 's1', status: 'active' } as ProjectDetailDTO['activeSprint'] & object;
    applyProjectEvent(qc, P, { type: 'sprint.upserted', sprint });
    expect(qc.getQueryData<ProjectDetailDTO>(keys.project(P))!.activeSprint?.id).toBe('s1');
    applyProjectEvent(qc, P, { type: 'sprint.upserted', sprint: { ...sprint, status: 'completed' } });
    expect(qc.getQueryData<ProjectDetailDTO>(keys.project(P))!.activeSprint).toBeNull();
  });
});
