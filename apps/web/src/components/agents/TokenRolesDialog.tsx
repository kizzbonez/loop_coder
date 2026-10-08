import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../lib/api';
import { useTokenMutations } from '../../lib/queries';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { RolePicker } from './RolePicker';

/** Change which roles the agent behind one of your tokens plays. */
export function TokenRolesDialog({ token, onClose }: { token: { id: string; name: string; roleKeys: string[] | null } | null; onClose: () => void }) {
  const m = useTokenMutations();
  const [roleKeys, setRoleKeys] = useState<string[] | null>(token?.roleKeys ?? null);
  useEffect(() => setRoleKeys(token?.roleKeys ?? null), [token]);

  return (
    <Modal
      open={token !== null}
      onClose={onClose}
      title={token ? `Roles for “${token.name}”` : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Save}
            disabled={roleKeys?.length === 0}
            loading={m.setRoles.isPending}
            onClick={() =>
              token &&
              m.setRoles.mutate(
                { id: token.id, roleKeys },
                {
                  onSuccess: () => {
                    toast.success('Roles saved. The agent gets matching work from its next step.');
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Save
          </Button>
        </>
      }
    >
      {token && <RolePicker value={roleKeys} onChange={setRoleKeys} />}
    </Modal>
  );
}
