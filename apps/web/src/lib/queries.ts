import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ReplayDTO,
  ActivityDTO,
  RemarkDTO,
  AdminStatsDTO,
  AgentRoleDTO,
  AgentRoleInput,
  AgentSessionDTO,
  ApiTokenDTO,
  AuditLogDTO,
  BurndownPointDTO,
  ColumnDTO,
  CreatedTokenDTO,
  CreateProjectInput,
  CreateTaskInput,
  CreateTokenInput,
  CreateWorkspaceInput,
  FileEntryDTO,
  MemberDTO,
  ProjectDetailDTO,
  ProjectDTO,
  PublicConfigDTO,
  SessionDTO,
  Settings,
  SprintDTO,
  SystemInfoDTO,
  TaskDetailDTO,
  TaskDTO,
  UpdateColumnInput,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateWorkspaceInput,
  UserDTO,
  WorkspaceDTO,
  WorkspaceRole,
} from '@loop/shared';
import { api, ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

type Items<T> = { items: T[] };

export const keys = {
  config: ['config'] as const,
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  workspaceProjects: (id: string) => ['workspace', id, 'projects'] as const,
  members: (id: string) => ['workspace', id, 'members'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  tasks: (projectId: string) => ['project', projectId, 'tasks'] as const,
  task: (id: string) => ['task', id] as const,
  sprints: (projectId: string) => ['project', projectId, 'sprints'] as const,
  burndown: (sprintId: string) => ['sprint', sprintId, 'burndown'] as const,
  activity: (projectId: string) => ['project', projectId, 'activity'] as const,
  flow: (projectId: string) => ['project', projectId, 'flow'] as const,
  /** Not under ['project', id]: a replay must not change while it plays (reconnects refresh those). */
  replay: (projectId: string, segment: string) => ['replay', projectId, segment] as const,
  liveRemarks: (projectId: string) => ['project', projectId, 'live-remarks'] as const,
  agentSessions: (projectId: string) => ['project', projectId, 'agent-sessions'] as const,
  files: (projectId: string, path: string) => ['project', projectId, 'files', path] as const,
  file: (projectId: string, path: string) => ['project', projectId, 'file', path] as const,
  roles: ['agent-roles'] as const,
  tokens: ['account', 'tokens'] as const,
  sessions: ['account', 'sessions'] as const,
  admin: {
    stats: ['admin', 'stats'] as const,
    system: ['admin', 'system'] as const,
    users: ['admin', 'users'] as const,
    workspaces: ['admin', 'workspaces'] as const,
    projects: ['admin', 'projects'] as const,
    roles: ['admin', 'roles'] as const,
    settings: ['admin', 'settings'] as const,
    tokens: ['admin', 'tokens'] as const,
    agentSessions: ['admin', 'agent-sessions'] as const,
    audit: (filter: string) => ['admin', 'audit', filter] as const,
  },
};

// ---------------------------------------------------------------------------
// Session & config
// ---------------------------------------------------------------------------

export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: () => api.get<PublicConfigDTO>('/config'), staleTime: 60_000 });

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return (await api.get<{ user: UserDTO }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const useWorkspaces = () =>
  useQuery({ queryKey: keys.workspaces, queryFn: async () => (await api.get<Items<WorkspaceDTO>>('/workspaces')).items });

export const useWorkspace = (id: string | undefined) =>
  useQuery({ queryKey: keys.workspace(id ?? ''), queryFn: () => api.get<WorkspaceDTO>(`/workspaces/${id}`), enabled: Boolean(id) });

export const useWorkspaceProjects = (id: string | undefined) =>
  useQuery({
    queryKey: keys.workspaceProjects(id ?? ''),
    queryFn: async () => (await api.get<Items<ProjectDTO>>(`/workspaces/${id}/projects`)).items,
    enabled: Boolean(id),
  });

export const useMembers = (workspaceId: string) =>
  useQuery({
    queryKey: keys.members(workspaceId),
    queryFn: async () => (await api.get<Items<MemberDTO>>(`/workspaces/${workspaceId}/members`)).items,
  });

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => api.post<WorkspaceDTO>('/workspaces', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useUpdateWorkspace(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => api.patch<WorkspaceDTO>(`/workspaces/${id}`, input),
    onSuccess: (ws) => {
      qc.setQueryData(keys.workspace(id), ws);
      void qc.invalidateQueries({ queryKey: keys.workspaces });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/workspaces/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useMemberMutations(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
    void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
  };
  return {
    add: useMutation({
      mutationFn: (input: { email: string; role: WorkspaceRole }) => api.post(`/workspaces/${workspaceId}/members`, input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
        api.patch(`/workspaces/${workspaceId}/members/${userId}`, { role }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => api.delete(`/workspaces/${workspaceId}/members/${userId}`),
      onSuccess: refresh,
    }),
    transfer: useMutation({
      mutationFn: (userId: string) => api.post<WorkspaceDTO>(`/workspaces/${workspaceId}/transfer`, { userId }),
      onSuccess: refresh,
    }),
  };
}

// ---------------------------------------------------------------------------
// Projects & board
// ---------------------------------------------------------------------------

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: async () => (await api.get<Items<ProjectDTO>>('/projects')).items });

export const useProject = (id: string) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => api.get<ProjectDetailDTO>(`/projects/${id}`), enabled: Boolean(id) });

export const useTasks = (projectId: string) =>
  useQuery({ queryKey: keys.tasks(projectId), queryFn: async () => (await api.get<Items<TaskDTO>>(`/projects/${projectId}/tasks`)).items });

export const useTask = (id: string | null) =>
  useQuery({ queryKey: keys.task(id ?? ''), queryFn: () => api.get<TaskDetailDTO>(`/tasks/${id}`), enabled: Boolean(id) });

export const useRoles = () =>
  useQuery({ queryKey: keys.roles, queryFn: async () => (await api.get<Items<AgentRoleDTO>>('/agent-roles')).items, staleTime: 5 * 60_000 });

export const useActivity = (projectId: string, limit = 100) =>
  useQuery({
    queryKey: keys.activity(projectId),
    queryFn: async () => (await api.get<Items<ActivityDTO>>(`/projects/${projectId}/activity?limit=${limit}`)).items,
  });

/** Events that move work or agents through the SDLC, newest first; kept live by the project stream. */
export const FLOW_HISTORY_LIMIT = 1000;
export const useFlowActivity = (projectId: string) =>
  useQuery({
    queryKey: keys.flow(projectId),
    queryFn: async () => (await api.get<Items<ActivityDTO>>(`/projects/${projectId}/activity?kind=flow&limit=${FLOW_HISTORY_LIMIT}`)).items,
  });

/**
 * One segment of the history for replays. Loaded once and kept as it was: live changes and
 * reconnects do not touch it, so the replay holds still while it plays.
 */
export const useReplayData = (projectId: string, segment: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.replay(projectId, segment),
    queryFn: () => api.get<ReplayDTO>(`/projects/${projectId}/replay?segment=${encodeURIComponent(segment)}`),
    enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

/** Remarks that arrived over the live stream since the page opened (newest first). */
export function useLiveRemarks(projectId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.liveRemarks(projectId),
    // Nothing to fetch: the project stream fills this cache, and a refetch must not wipe it.
    queryFn: () => qc.getQueryData<RemarkDTO[]>(keys.liveRemarks(projectId)) ?? [],
    staleTime: Infinity,
  });
}

export const useAgentSessions = (projectId: string) =>
  useQuery({
    queryKey: keys.agentSessions(projectId),
    queryFn: async () => (await api.get<Items<AgentSessionDTO>>(`/projects/${projectId}/agent-sessions`)).items,
    refetchInterval: 30_000,
  });

export const useSprints = (projectId: string) =>
  useQuery({ queryKey: keys.sprints(projectId), queryFn: async () => (await api.get<Items<SprintDTO>>(`/projects/${projectId}/sprints`)).items });

export const useBurndown = (sprintId: string | undefined) =>
  useQuery({
    queryKey: keys.burndown(sprintId ?? ''),
    queryFn: async () => (await api.get<Items<BurndownPointDTO>>(`/sprints/${sprintId}/burndown`)).items,
    enabled: Boolean(sprintId),
  });

export const useFiles = (projectId: string, path: string, enabled = true) =>
  useQuery({
    queryKey: keys.files(projectId, path),
    queryFn: async () => (await api.get<Items<FileEntryDTO>>(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`)).items,
    enabled,
    retry: false,
  });

export interface FileContent {
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
}

export const useFileContent = (projectId: string, path: string | null) =>
  useQuery({
    queryKey: keys.file(projectId, path ?? ''),
    queryFn: () => api.get<FileContent>(`/projects/${projectId}/files/content?path=${encodeURIComponent(path ?? '')}`),
    enabled: Boolean(path),
  });

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<ProjectDetailDTO>('/projects', input),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: keys.workspaceProjects(p.workspaceId) });
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: keys.workspaces });
    },
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => api.patch<ProjectDTO>(`/projects/${id}`, input),
    onSuccess: (p) => qc.setQueryData<ProjectDetailDTO>(keys.project(id), (old) => (old ? { ...old, ...p } : old)),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

export function useUpdateColumn(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ columnId, input }: { columnId: string; input: UpdateColumnInput }) =>
      api.patch<Items<ColumnDTO>>(`/projects/${projectId}/columns/${columnId}`, input),
    onSuccess: ({ items }) =>
      qc.setQueryData<ProjectDetailDTO>(keys.project(projectId), (old) => (old ? { ...old, columns: items } : old)),
  });
}

/** Insert or replace a work item in the cached board list. */
export function upsertTaskInCache(qc: QueryClient, task: TaskDTO): void {
  qc.setQueryData<TaskDTO[]>(keys.tasks(task.projectId), (old) => {
    if (!old) return old;
    const i = old.findIndex((t) => t.id === task.id);
    if (i === -1) return [...old, task];
    const next = old.slice();
    next[i] = task;
    return next;
  });
  qc.setQueryData<TaskDetailDTO>(keys.task(task.id), (old) => (old ? { ...old, ...task } : old));
}

export function useTaskMutations(projectId: string) {
  const qc = useQueryClient();
  const onTask = (t: TaskDTO) => upsertTaskInCache(qc, t);
  return {
    create: useMutation({
      mutationFn: (input: CreateTaskInput) => api.post<TaskDTO>(`/projects/${projectId}/tasks`, input),
      onSuccess: onTask,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) => api.patch<TaskDTO>(`/tasks/${id}`, input),
      onSuccess: onTask,
    }),
    move: useMutation({
      mutationFn: ({ id, columnId, index }: { id: string; columnId: string; index: number }) =>
        api.post<TaskDTO>(`/tasks/${id}/move`, { columnId, index }),
      onSuccess: onTask,
      onError: () => qc.invalidateQueries({ queryKey: keys.tasks(projectId) }),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/tasks/${id}`),
      onSuccess: (_d, id) => qc.setQueryData<TaskDTO[]>(keys.tasks(projectId), (old) => old?.filter((t) => t.id !== id)),
    }),
    remark: useMutation({
      mutationFn: ({ id, body, kind, resume }: { id: string; body: string; kind: 'comment' | 'answer'; resume: boolean }) =>
        api.post<TaskDetailDTO>(`/tasks/${id}/remarks`, { body, kind, resume }),
      onSuccess: (t) => {
        qc.setQueryData(keys.task(t.id), t);
        onTask(t);
      },
    }),
  };
}

export function useSprintMutations(projectId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.sprints(projectId) });
    void qc.invalidateQueries({ queryKey: keys.project(projectId) });
    void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
  };
  return {
    create: useMutation({
      mutationFn: (input: { name: string; goal: string }) => api.post<SprintDTO>(`/projects/${projectId}/sprints`, input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: { name?: string; goal?: string } }) => api.patch<SprintDTO>(`/sprints/${id}`, input),
      onSuccess: refresh,
    }),
    start: useMutation({ mutationFn: (id: string) => api.post<SprintDTO>(`/sprints/${id}/start`), onSuccess: refresh }),
    complete: useMutation({
      mutationFn: ({ id, reviewNotes, retroNotes }: { id: string; reviewNotes: string; retroNotes: string }) =>
        api.post<SprintDTO>(`/sprints/${id}/complete`, { reviewNotes, retroNotes }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/sprints/${id}`), onSuccess: refresh }),
  };
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const useTokens = () =>
  useQuery({ queryKey: keys.tokens, queryFn: async () => (await api.get<Items<ApiTokenDTO>>('/account/tokens')).items });

export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: async () => (await api.get<Items<SessionDTO>>('/account/sessions')).items });

export function useTokenMutations() {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (input: CreateTokenInput) => api.post<CreatedTokenDTO>('/account/tokens', input),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.tokens }),
    }),
    revoke: useMutation({
      mutationFn: (id: string) => api.delete(`/account/tokens/${id}`),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.tokens }),
    }),
    setRoles: useMutation({
      mutationFn: ({ id, roleKeys }: { id: string; roleKeys: string[] | null }) => api.patch<ApiTokenDTO>(`/account/tokens/${id}`, { roleKeys }),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.tokens }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const useAdminStats = () =>
  useQuery({ queryKey: keys.admin.stats, queryFn: () => api.get<AdminStatsDTO>('/admin/stats'), refetchInterval: 15_000 });
export const useSystemInfo = () => useQuery({ queryKey: keys.admin.system, queryFn: () => api.get<SystemInfoDTO>('/admin/system') });
export const useAdminUsers = () =>
  useQuery({ queryKey: keys.admin.users, queryFn: async () => (await api.get<Items<UserDTO>>('/admin/users')).items });
export const useAdminWorkspaces = () =>
  useQuery({ queryKey: keys.admin.workspaces, queryFn: async () => (await api.get<Items<WorkspaceDTO>>('/admin/workspaces')).items });
export const useAdminProjects = () =>
  useQuery({ queryKey: keys.admin.projects, queryFn: async () => (await api.get<Items<ProjectDTO>>('/admin/projects')).items });
export const useAdminRoles = () =>
  useQuery({ queryKey: keys.admin.roles, queryFn: async () => (await api.get<Items<AgentRoleDTO>>('/admin/agent-roles')).items });
export const useAdminSettings = () => useQuery({ queryKey: keys.admin.settings, queryFn: () => api.get<Settings>('/admin/settings') });
export const useAdminTokens = () =>
  useQuery({ queryKey: keys.admin.tokens, queryFn: async () => (await api.get<Items<ApiTokenDTO>>('/admin/tokens')).items });
export const useAdminAgentSessions = () =>
  useQuery({
    queryKey: keys.admin.agentSessions,
    queryFn: async () => (await api.get<Items<AgentSessionDTO>>('/admin/agent-sessions')).items,
    refetchInterval: 15_000,
  });
export const useAudit = (action: string) =>
  useQuery({
    queryKey: keys.admin.audit(action),
    queryFn: () => api.get<{ items: AuditLogDTO[]; nextCursor: string | null }>(`/admin/audit?limit=100${action ? `&action=${encodeURIComponent(action)}` : ''}`),
  });

export function useAdminMutations() {
  const qc = useQueryClient();
  const users = () => qc.invalidateQueries({ queryKey: keys.admin.users });
  const roles = () => {
    void qc.invalidateQueries({ queryKey: keys.admin.roles });
    void qc.invalidateQueries({ queryKey: keys.roles });
  };
  return {
    createUser: useMutation({
      mutationFn: (input: { email: string; name: string; password: string; role: 'admin' | 'user' }) => api.post<UserDTO>('/admin/users', input),
      onSuccess: users,
    }),
    updateUser: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<Pick<UserDTO, 'name' | 'role' | 'status'>> }) =>
        api.patch<UserDTO>(`/admin/users/${id}`, input),
      onSuccess: users,
    }),
    deleteUser: useMutation({ mutationFn: (id: string) => api.delete(`/admin/users/${id}`), onSuccess: users }),
    resetPassword: useMutation({
      mutationFn: ({ id, password }: { id: string; password: string }) => api.post(`/admin/users/${id}/reset-password`, { password }),
    }),
    unlock: useMutation({ mutationFn: (id: string) => api.post(`/admin/users/${id}/unlock`), onSuccess: users }),
    revokeSessions: useMutation({ mutationFn: (id: string) => api.post<{ revoked: number }>(`/admin/users/${id}/revoke-sessions`) }),
    createRole: useMutation({ mutationFn: (input: AgentRoleInput) => api.post<AgentRoleDTO>('/admin/agent-roles', input), onSuccess: roles }),
    updateRole: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<AgentRoleInput> }) => api.patch<AgentRoleDTO>(`/admin/agent-roles/${id}`, input),
      onSuccess: roles,
    }),
    deleteRole: useMutation({ mutationFn: (id: string) => api.delete(`/admin/agent-roles/${id}`), onSuccess: roles }),
    saveSettings: useMutation({
      mutationFn: (s: Settings) => api.put<Settings>('/admin/settings', s),
      onSuccess: (s) => {
        qc.setQueryData(keys.admin.settings, s);
        void qc.invalidateQueries({ queryKey: keys.config });
      },
    }),
    revokeToken: useMutation({
      mutationFn: (id: string) => api.delete(`/admin/tokens/${id}`),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.admin.tokens }),
    }),
    deleteWorkspace: useMutation({
      mutationFn: (id: string) => api.delete(`/admin/workspaces/${id}`),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: keys.admin.workspaces });
        void qc.invalidateQueries({ queryKey: keys.workspaces });
      },
    }),
  };
}
