import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from './components/layout/AppShell';
import { PageLoader } from './components/ui/misc';
import { onUnauthorized } from './lib/api';
import { keys, useConfig, useMe } from './lib/queries';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { HomeRedirect } from './pages/HomeRedirect';
import { NotFound } from './pages/NotFound';

/** Code-split a page that is a named export (keeps the initial bundle small). */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

const SetupWizard = page(() => import('./pages/auth/SetupWizard'), 'SetupWizard');
const AccountPage = page(() => import('./pages/account/AccountPage'), 'AccountPage');
const GuidePage = page(() => import('./pages/guide/GuidePage'), 'GuidePage');
const WorkspaceLayout = page(() => import('./pages/workspace/WorkspaceLayout'), 'WorkspaceLayout');
const WorkspaceProjects = page(() => import('./pages/workspace/WorkspaceProjects'), 'WorkspaceProjects');
const WorkspaceMembers = page(() => import('./pages/workspace/WorkspaceMembers'), 'WorkspaceMembers');
const WorkspaceSettings = page(() => import('./pages/workspace/WorkspaceSettings'), 'WorkspaceSettings');
const ProjectLayout = page(() => import('./pages/project/ProjectLayout'), 'ProjectLayout');
const BoardView = page(() => import('./pages/project/BoardView'), 'BoardView');
const FlowView = page(() => import('./pages/project/flow/FlowView'), 'FlowView');
const OfficeView = page(() => import('./pages/project/office/OfficeView'), 'OfficeView');
const BacklogView = page(() => import('./pages/project/BacklogView'), 'BacklogView');
const SprintsView = page(() => import('./pages/project/SprintsView'), 'SprintsView');
const ActivityView = page(() => import('./pages/project/ActivityView'), 'ActivityView');
const FilesView = page(() => import('./pages/project/FilesView'), 'FilesView');
const AgentView = page(() => import('./pages/project/AgentView'), 'AgentView');
const ProjectSettingsView = page(() => import('./pages/project/ProjectSettingsView'), 'ProjectSettingsView');
const AdminLayout = page(() => import('./pages/admin/AdminLayout'), 'AdminLayout');
const AdminOverview = page(() => import('./pages/admin/AdminOverview'), 'AdminOverview');
const AdminUsers = page(() => import('./pages/admin/AdminUsers'), 'AdminUsers');
const AdminWorkspaces = page(() => import('./pages/admin/AdminWorkspaces'), 'AdminWorkspaces');
const AdminRoles = page(() => import('./pages/admin/AdminRoles'), 'AdminRoles');
const AdminAgents = page(() => import('./pages/admin/AdminAgents'), 'AdminAgents');
const AdminTokens = page(() => import('./pages/admin/AdminTokens'), 'AdminTokens');
const AdminSettings = page(() => import('./pages/admin/AdminSettings'), 'AdminSettings');
const AdminAudit = page(() => import('./pages/admin/AdminAudit'), 'AdminAudit');
const AdminSystem = page(() => import('./pages/admin/AdminSystem'), 'AdminSystem');

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <PageLoader />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const config = useConfig();
  const qc = useQueryClient();
  const location = useLocation();

  // Any 401 from the API means the session ended: drop cached user data.
  useEffect(() => onUnauthorized(() => qc.setQueryData(keys.me, null)), [qc]);

  useEffect(() => {
    if (config.data?.appName) document.title = config.data.appName;
  }, [config.data?.appName]);

  if (config.isPending) return <PageLoader />;
  if (config.data?.setupRequired && location.pathname !== '/setup') return <Navigate to="/setup" replace />;

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="w/:workspaceId" element={<WorkspaceLayout />}>
            <Route index element={<WorkspaceProjects />} />
            <Route path="members" element={<WorkspaceMembers />} />
            <Route path="settings" element={<WorkspaceSettings />} />
          </Route>
          <Route path="p/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="board" replace />} />
            <Route path="board" element={<BoardView />} />
            <Route path="flow" element={<FlowView />} />
            <Route path="office" element={<OfficeView />} />
            <Route path="backlog" element={<BacklogView />} />
            <Route path="sprints" element={<SprintsView />} />
            <Route path="activity" element={<ActivityView />} />
            <Route path="files" element={<FilesView />} />
            <Route path="agent" element={<AgentView />} />
            <Route path="settings" element={<ProjectSettingsView />} />
          </Route>
          <Route path="account" element={<AccountPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="guide/:slug" element={<GuidePage />} />
          <Route
            path="admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<AdminOverview />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="workspaces" element={<AdminWorkspaces />} />
            <Route path="roles" element={<AdminRoles />} />
            <Route path="agents" element={<AdminAgents />} />
            <Route path="tokens" element={<AdminTokens />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="system" element={<AdminSystem />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster
        position="bottom-right"
        theme="system"
        toastOptions={{ className: '!bg-surface !text-fg !border-line !shadow-pop' }}
      />
    </Suspense>
  );
}
