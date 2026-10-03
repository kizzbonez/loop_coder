import { Clock, Database, Download, FolderTree, GitBranch, Server, Tag } from 'lucide-react';
import { PageLoader, Section, StatCard } from '../../components/ui/misc';
import { formatBytes, formatDateTime, formatDuration } from '../../lib/format';
import { useSystemInfo } from '../../lib/queries';
import { CLIENT_COMMIT, CLIENT_VERSION, shortCommit } from '../../lib/version';

export function AdminSystem() {
  const info = useSystemInfo();
  if (info.isPending) return <PageLoader />;
  const s = info.data!;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Tag} label="Server version" value={`v${s.version.version}`} hint={`web v${CLIENT_VERSION} (${shortCommit(CLIENT_COMMIT)})`} />
        <StatCard icon={GitBranch} label="Commit" value={shortCommit(s.version.commit)} hint={s.version.buildTime ? `built ${formatDateTime(s.version.buildTime)}` : 'development build'} />
        <StatCard icon={Clock} label="Uptime" value={formatDuration(s.uptimeSeconds)} hint={`Node ${s.node}`} />
        <StatCard icon={Database} label="Database size" value={formatBytes(s.database.sizeBytes)} hint={`schema v${s.database.schemaVersion}`} />
      </div>

      <Section title="Database" description="SQLite in WAL mode, stored on the Docker volume. It is created automatically on first start and migrated on every start.">
        <dl className="grid gap-2 text-[13px] sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">File</dt>
          <dd className="font-mono text-xs">{s.database.path}</dd>
          <dt className="text-muted">Schema version</dt>
          <dd>{s.database.schemaVersion} migration(s) applied</dd>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href="/api/admin/backup"
            download
            className="brand-gradient inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-accent-fg shadow-[0_6px_20px_-8px_var(--accent)] hover:brightness-110"
          >
            <Download className="size-4" /> Download backup
          </a>
          <p className="text-xs text-subtle">A consistent online snapshot (safe while the app is running). Store it somewhere secure: it contains all data, including password hashes.</p>
        </div>
      </Section>

      <Section title="Environment">
        <ul className="space-y-2 text-[13px]">
          <li className="flex items-center gap-2">
            <Server className="size-4 text-subtle" /> MCP endpoint: <code className="font-mono text-xs">{window.location.origin}/mcp</code>
          </li>
          <li className="flex items-center gap-2">
            <FolderTree className="size-4 text-subtle" /> File browser: {s.workspacesConfigured ? 'enabled (workspaces mounted read-only)' : 'not configured'}
          </li>
        </ul>
      </Section>
    </div>
  );
}
