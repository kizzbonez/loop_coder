import { Building } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Field';
import { EmptyState, PageLoader } from '../components/ui/misc';
import { errorMessage } from '../lib/api';
import { useCreateWorkspace, useWorkspaces } from '../lib/queries';
import { lastWorkspace } from '../lib/workspace-context';

/** "/" → the last visited workspace, the first one, or an invitation to create one. */
export function HomeRedirect() {
  const workspaces = useWorkspaces();
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  if (workspaces.isPending) return <PageLoader />;
  const list = workspaces.data ?? [];
  const remembered = lastWorkspace();
  const target = list.find((w) => w.id === remembered) ?? list[0];
  if (target) return <Navigate to={`/w/${target.id}`} replace />;

  return (
    <div className="mx-auto max-w-lg p-8">
      <EmptyState
        icon={Building}
        title="Create your first workspace"
        description="Workspaces contain projects and the people who collaborate on them. You can also ask a workspace owner to invite you."
        action={
          <form
            className="flex w-full max-w-sm gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                { name: name.trim() },
                { onSuccess: (ws) => navigate(`/w/${ws.id}`), onError: (err) => toast.error(errorMessage(err)) },
              );
            }}
          >
            <Input placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="primary" disabled={!name.trim()} loading={create.isPending}>
              Create
            </Button>
          </form>
        }
      />
    </div>
  );
}
