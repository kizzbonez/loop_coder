import clsx from 'clsx';
import { ChevronRight, File, Folder, FolderTree, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../../components/ui/Button';
import { CodeBlock, EmptyState, PageLoader, Spinner } from '../../components/ui/misc';
import { ApiError } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useFileContent, useFiles } from '../../lib/queries';
import { useProjectContext } from './context';

function Directory({ projectId, path, depth, selected, onSelect }: { projectId: string; path: string; depth: number; selected: string | null; onSelect: (p: string) => void }) {
  const entries = useFiles(projectId, path);
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (entries.isPending) return <Spinner className="m-2 size-4" />;
  return (
    <ul>
      {(entries.data ?? []).map((e) => {
        const full = path ? `${path}/${e.name}` : e.name;
        const isOpen = open.has(full);
        return (
          <li key={full}>
            <button
              type="button"
              className={clsx(
                'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition hover:bg-surface-2',
                selected === full && 'bg-accent-soft text-accent',
              )}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => {
                if (e.type === 'dir') {
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(full)) n.delete(full);
                    else n.add(full);
                    return n;
                  });
                } else onSelect(full);
              }}
            >
              {e.type === 'dir' ? (
                <>
                  <ChevronRight className={clsx('size-3.5 text-subtle transition', isOpen && 'rotate-90')} />
                  <Folder className="size-4 text-accent" />
                </>
              ) : (
                <>
                  <span className="w-3.5" />
                  <File className="size-4 text-subtle" />
                </>
              )}
              <span className="truncate">{e.name}</span>
            </button>
            {e.type === 'dir' && isOpen && <Directory projectId={projectId} path={full} depth={depth + 1} selected={selected} onSelect={onSelect} />}
          </li>
        );
      })}
    </ul>
  );
}

export function FilesView() {
  const { project } = useProjectContext();
  const root = useFiles(project.id, '');
  const [selected, setSelected] = useState<string | null>(null);
  const file = useFileContent(project.id, selected);

  if (root.isPending) return <PageLoader />;
  if (root.error instanceof ApiError && root.error.status === 501) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <EmptyState
          icon={FolderTree}
          title="File browser not configured"
          description="Mount your workspaces folder into the API container (WORKSPACES_DIR) to browse the code the agent writes. The default docker-compose.yml already mounts ./workspaces."
        />
      </div>
    );
  }
  if ((root.data ?? []).length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <EmptyState
          icon={FolderTree}
          title="No files yet"
          description={
            <>
              The agent writes this project's code to <code className="font-mono text-fg">workspaces/{project.workspacePath}</code>. Files appear here as soon as work starts.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[500px] md:grid-cols-[280px_1fr]">
      <aside className="overflow-y-auto border-b border-line p-2 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="truncate font-mono text-xs text-subtle">{project.workspacePath}</span>
          <IconButton icon={RefreshCw} size="sm" label="Refresh" onClick={() => void root.refetch()} />
        </div>
        <Directory projectId={project.id} path="" depth={0} selected={selected} onSelect={setSelected} />
      </aside>
      <section className="min-w-0 overflow-auto p-4">
        {!selected ? (
          <p className="text-[13px] text-subtle">Select a file to view it (read-only).</p>
        ) : file.isPending ? (
          <Spinner />
        ) : file.data ? (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">
              <span className="font-mono text-fg">{file.data.path}</span>
              <span>{formatBytes(file.data.size)}</span>
              {file.data.truncated && <span className="text-warning">showing the first 512 KB</span>}
            </div>
            {file.data.binary ? <p className="text-[13px] text-subtle">Binary file, not displayed.</p> : <CodeBlock code={file.data.content ?? ''} />}
          </div>
        ) : (
          <p className="text-[13px] text-danger">Could not load the file.</p>
        )}
      </section>
    </div>
  );
}
