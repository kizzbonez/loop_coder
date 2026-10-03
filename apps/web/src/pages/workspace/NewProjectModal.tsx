import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { ApiError, errorMessage } from '../../lib/api';
import { useCreateProject } from '../../lib/queries';

function suggestKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  const cleaned = key.replace(/^[0-9]+/, '').slice(0, 6);
  return cleaned.length >= 2 ? cleaned : (cleaned + 'PRJ').slice(0, 4);
}

export function NewProjectModal({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateProject();
  const navigate = useNavigate();

  const reset = () => {
    setName('');
    setKey('');
    setKeyTouched(false);
    setDescription('');
    setErrors({});
  };

  const submit = () =>
    create.mutate(
      { workspaceId, name: name.trim(), key: key.trim(), description },
      {
        onSuccess: (p) => {
          toast.success(`Project ${p.key} created`);
          reset();
          onClose();
          navigate(`/p/${p.id}/agent`);
        },
        onError: (e) => {
          if (e instanceof ApiError) setErrors(e.fieldErrors());
          if (!(e instanceof ApiError) || !e.details) toast.error(errorMessage(e));
        },
      },
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New project"
      description="Describe what to build. Your AI agent starts with a kickoff as Project Manager and turns this into an agile backlog."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!name.trim() || key.length < 2}>
            Create project
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Input
          label="Project name"
          placeholder="e.g. Online Shop"
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (!keyTouched) setKey(suggestKey(e.target.value));
          }}
        />
        <Input
          label="Key"
          value={key}
          error={errors.key}
          maxLength={8}
          className="font-mono uppercase"
          hint="Prefix for item keys, e.g. SHOP-12"
          onChange={(e) => {
            setKeyTouched(true);
            setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
          }}
        />
      </div>
      <Textarea
        className="mt-4"
        label="Goal and requirements"
        rows={8}
        placeholder={
          'What should be built, for whom, and why?\n\nExample: A web shop for handmade candles. Customers browse products, add them to a cart and check out with Stripe. Admins manage products and orders. Use React + Node + PostgreSQL.'
        }
        value={description}
        error={errors.description}
        onChange={(e) => setDescription(e.target.value)}
        hint="The more context you give (users, features, constraints, tech preferences), the better the backlog."
      />
    </Modal>
  );
}
