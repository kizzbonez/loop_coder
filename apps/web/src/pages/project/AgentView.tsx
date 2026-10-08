import clsx from 'clsx';
import { BookOpen, Bot, KeyRound, Plug, Repeat, Terminal, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { MCP_SERVER_NAME } from '@loop/shared';
import { ProjectAgents } from '../../components/agents/ProjectAgents';
import { RolePicker } from '../../components/agents/RolePicker';
import { Badge, Chip } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CodeBlock, Section } from '../../components/ui/misc';
import { errorMessage } from '../../lib/api';
import { formatDateTime, timeAgo } from '../../lib/format';
import { useAgentSessions, useTokenMutations } from '../../lib/queries';
import { useBoardLookups, useProjectContext } from './context';

type ClientId = 'claude' | 'cursor' | 'vscode' | 'other';
type OsId = 'windows' | 'unix';

const CLIENTS: Array<{ id: ClientId; label: string; hint: string }> = [
  { id: 'claude', label: 'Claude Code', hint: 'CLI, desktop app or IDE extension' },
  { id: 'cursor', label: 'Cursor', hint: 'Agent mode' },
  { id: 'vscode', label: 'VS Code', hint: 'GitHub Copilot agent mode' },
  { id: 'other', label: 'Other MCP client', hint: 'Windsurf, Cline, Codex, Gemini CLI…' },
];

function usePersistentChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      return stored && allowed.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  return [
    value,
    (v) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage unavailable */
      }
    },
  ];
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }>; label: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={clsx('rounded-md px-3 py-1 text-[13px] font-medium transition', value === o.id ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative flex gap-4">
      <span className="brand-gradient flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">{n}</span>
      <div className="min-w-0 flex-1 pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="mt-2 space-y-2 text-[13px] text-muted">{children}</div>
      </div>
    </li>
  );
}

const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-surface-3 px-1 font-mono text-[12px] text-fg">{children}</code>;

/** The loop instructions for clients without MCP prompt support. */
export function loopInstructions(projectKey: string): string {
  return `You are the autonomous delivery team for the Loop Coder project ${projectKey}: one agent playing every Scrum/SDLC role (Project Manager, Architect, UI/UX Designer, Senior, Backend and Frontend Developer, Code Reviewer, QA, DevOps, Security, Tech Writer).

Use the "${MCP_SERVER_NAME}" MCP tools:
1. Call get_next_work with project "${projectKey}".
2. Play the role it names and follow its instructions exactly. Do the real work in this folder.
3. Finish the step with the tool the instructions name (move_work_item, mark_refined, start_sprint, complete_sprint, complete_kickoff or request_human_input).
4. Repeat from step 1.

When get_next_work reports PAUSED or WAITING, do not end: call wait_for_work with project "${projectKey}" and keep calling it while it reports PAUSED or WAITING. It returns the next work as soon as a human resumes the project or answers; then carry on from step 2. End, with a summary of what you did, only when it reports STOPPED, COMPLETE or DISABLED.`;
}

export function AgentView() {
  const { project, tasks, roles, canEdit } = useProjectContext();
  const lookups = useBoardLookups(project, tasks, roles);
  const sessions = useAgentSessions(project.id);
  const tokens = useTokenMutations();
  const [secret, setSecret] = useState<string | null>(null);
  const [roleKeys, setRoleKeys] = useState<string[] | null>(null);
  const [client, setClient] = usePersistentChoice<ClientId>('lc-agent-client', ['claude', 'cursor', 'vscode', 'other'], 'claude');
  const defaultOs: OsId = /Windows/i.test(navigator.userAgent) ? 'windows' : 'unix';
  const [os, setOs] = usePersistentChoice<OsId>('lc-agent-os', ['windows', 'unix'], defaultOs);

  const url = `${window.location.origin}/mcp`;
  const token = secret ?? '<YOUR_TOKEN>';
  const auth = `Bearer ${token}`;
  const folder = `workspaces/${project.workspacePath}`;
  const clientLabel = CLIENTS.find((c) => c.id === client)!.label;
  const prompt = `/mcp__${MCP_SERVER_NAME}__work ${project.key}`;

  const folderCommands =
    os === 'windows'
      ? `# In the Loop Coder folder (the one with docker-compose.yml), PowerShell:\nmkdir ${folder.replaceAll('/', '\\')} -Force\ncd ${folder.replaceAll('/', '\\')}\ngit init`
      : `# In the Loop Coder folder (the one with docker-compose.yml):\nmkdir -p ${folder} && cd ${folder} && git init`;

  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const mcpServersHttp = json({ mcpServers: { [MCP_SERVER_NAME]: { url, headers: { Authorization: auth } } } });
  const vscodeJson = json({ servers: { [MCP_SERVER_NAME]: { type: 'http', url, headers: { Authorization: auth } } } });
  const stdioBridge = json({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: 'npx',
        args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
        env: { AUTH_HEADER: auth },
      },
    },
  });
  const claudeMcpJson = json({ mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url, headers: { Authorization: 'Bearer ${LOOPCODER_TOKEN}' } } } });

  const tokenWarning = (file: string) => (
    <p className="flex items-start gap-1.5 text-xs text-warning">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>
        <Code>{file}</Code> contains your token: add it to the project's <Code>.gitignore</Code> so it is never committed.
      </span>
    </p>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <section className="card flex flex-wrap items-center gap-4 p-5">
        <span className="brand-gradient flex size-12 items-center justify-center rounded-2xl text-white">
          <Bot className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{project.agent.agentName ?? 'AI agent'}</h2>
            {project.agentState === 'paused' ? (
              <Badge tone="warning">Paused</Badge>
            ) : project.agentState === 'stopped' ? (
              <Badge>Stopped</Badge>
            ) : project.agent.online ? (
              <Badge tone="success">Online</Badge>
            ) : (
              <Badge>Offline</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-muted">
            {project.agent.online
              ? `${project.agent.currentActivity ?? 'Working'}${project.agent.clientName ? ` · ${project.agent.clientName}` : ''}`
              : project.agent.lastSeenAt
                ? `Last seen ${timeAgo(project.agent.lastSeenAt)}`
                : 'Not connected yet. Follow the steps below with any MCP-capable coding agent.'}
          </p>
        </div>
      </section>

      {canEdit && <ProjectAgents project={project} />}

      <Section
        title="Connect your AI agent"
        description="Any coding agent that supports MCP can work this board: it pulls the next item, plays the right role, writes remarks and moves the card on. Pick your tool for exact instructions."
        actions={
          <Link to="/guide/6-connecting-your-ai-agent" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
            <BookOpen className="size-4" /> Step-by-step guide
          </Link>
        }
      >
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Segmented label="Agent" value={client} onChange={setClient} options={CLIENTS.map((c) => ({ id: c.id, label: c.label }))} />
          <Segmented
            label="Operating system"
            value={os}
            onChange={setOs}
            options={[
              { id: 'windows', label: 'Windows' },
              { id: 'unix', label: 'macOS / Linux' },
            ]}
          />
          <span className="text-xs text-subtle">{CLIENTS.find((c) => c.id === client)!.hint}</span>
        </div>

        <ol className="space-y-5">
          <Step n={1} title="Create an access token for this project">
            <p>The token lets the agent act on this project only, with your permissions. It is shown once, so store it safely. It is filled into the snippets below automatically.</p>
            {canEdit &&
              (secret ? (
                <div className="rounded-lg border border-warning/40 bg-warning/8 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-warning">
                    <TriangleAlert className="size-3.5" /> Copy it now. You will not see it again.
                  </p>
                  <CodeBlock code={secret} />
                </div>
              ) : (
                <div className="space-y-3">
                  <RolePicker value={roleKeys} onChange={setRoleKeys} />
                  <Button
                    variant="primary"
                    icon={KeyRound}
                    loading={tokens.create.isPending}
                    disabled={roleKeys?.length === 0}
                    onClick={() =>
                      tokens.create.mutate(
                        { name: `${clientLabel} · ${project.key}`, projectId: project.id, expiresInDays: 90, roleKeys },
                        { onSuccess: (r) => setSecret(r.secret), onError: (e) => toast.error(errorMessage(e)) },
                      )
                    }
                  >
                    Create project token
                  </Button>
                </div>
              ))}
          </Step>

          <Step n={2} title="Create the project folder">
            <p>The agent writes this project's code here, and the Files tab shows it live. Its own git repository keeps the agent's commits separate.</p>
            <CodeBlock code={folderCommands} />
          </Step>

          <Step n={3} title={`Connect ${clientLabel} to Loop Coder`}>
            {client === 'claude' && (
              <>
                <p>
                  Run this <b>inside the project folder</b>. Claude Code registers the server for that folder; add <Code>--scope user</Code> to make it available everywhere.
                </p>
                <CodeBlock code={`claude mcp add --transport http ${MCP_SERVER_NAME} ${url} --header "Authorization: ${auth}"`} />
                <p>
                  Then start Claude Code there with <Code>claude</Code>. In the desktop app or an IDE extension, open this folder as the working folder. Check with <Code>/mcp</Code> that{' '}
                  <Code>{MCP_SERVER_NAME}</Code> is connected.
                </p>
                <details className="rounded-lg border border-line px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-fg">Alternative: a committed .mcp.json with the token in an environment variable</summary>
                  <div className="mt-2 space-y-2">
                    <CodeBlock code={claudeMcpJson} />
                    <p>
                      Set <Code>LOOPCODER_TOKEN</Code> in your environment ({os === 'windows' ? <Code>setx LOOPCODER_TOKEN "{token}"</Code> : <Code>export LOOPCODER_TOKEN={token}</Code>}). Claude Code expands it, so the file is safe to commit.
                    </p>
                  </div>
                </details>
              </>
            )}
            {client === 'cursor' && (
              <>
                <p>
                  Create <Code>.cursor/mcp.json</Code> in the project folder (or <Code>~/.cursor/mcp.json</Code> for all projects):
                </p>
                <CodeBlock code={mcpServersHttp} />
                {tokenWarning('.cursor/mcp.json')}
                <p>
                  Open the folder with <Code>cursor .</Code>, then enable <Code>{MCP_SERVER_NAME}</Code> under <b>Settings → MCP</b> and use the chat in <b>Agent</b> mode.
                </p>
              </>
            )}
            {client === 'vscode' && (
              <>
                <p>
                  Create <Code>.vscode/mcp.json</Code> in the project folder:
                </p>
                <CodeBlock code={vscodeJson} />
                {tokenWarning('.vscode/mcp.json')}
                <p>
                  Open the folder with <Code>code .</Code>, start <Code>{MCP_SERVER_NAME}</Code> from the MCP servers list, and use Copilot Chat in <b>Agent</b> mode.
                </p>
              </>
            )}
            {client === 'other' && (
              <>
                <p>Clients that support remote (Streamable HTTP) MCP servers with custom headers need only:</p>
                <dl className="grid gap-x-4 gap-y-1 rounded-lg border border-line p-3 font-mono text-[12px] sm:grid-cols-[8rem_1fr]">
                  <dt className="text-subtle">Transport</dt>
                  <dd className="text-fg">Streamable HTTP</dd>
                  <dt className="text-subtle">URL</dt>
                  <dd className="break-all text-fg">{url}</dd>
                  <dt className="text-subtle">Header</dt>
                  <dd className="break-all text-fg">Authorization: {auth}</dd>
                </dl>
                <p>Clients that only run local (stdio) servers can use the mcp-remote bridge (needs Node.js):</p>
                <CodeBlock code={stdioBridge} />
                <p>The server uses bearer tokens, not OAuth, so clients that only offer an OAuth login for remote servers need the bridge too.</p>
              </>
            )}
          </Step>

          <Step n={4} title="Start the loop">
            {client === 'claude' ? (
              <>
                <p>Run the server's prompt. The agent keeps working until the board is done or you stop it; while paused or waiting for you, it stays connected and carries on when you resume:</p>
                <CodeBlock code={prompt} />
                <p className="flex items-start gap-1.5">
                  <Repeat className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span>
                    To keep it running continuously, including when it is waiting for your answers, use <Code>/loop {prompt}</Code>.
                  </span>
                </p>
              </>
            ) : (
              <>
                <p>Paste these instructions into the agent chat (agent mode). If your client supports MCP prompts, you can run the server's <Code>work</Code> prompt instead.</p>
                <CodeBlock code={loopInstructions(project.key)} />
                <p>When it stops because it is waiting for you, answer on the board and send the same instructions again.</p>
              </>
            )}
          </Step>
        </ol>
      </Section>

      <Section title="Who does what" description="Each stage of the board is worked by a role. Change the mapping in Settings → Board columns.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {project.columns.map((c) => {
            const role = c.agentRoleId ? lookups.rolesById.get(c.agentRoleId) : undefined;
            return (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <span className="size-2 rounded-full" style={{ backgroundColor: c.color ?? '#64748b' }} />
                <span className="font-medium">{c.name}</span>
                <span className="ml-auto">
                  {c.roleSource === 'task' ? (
                    <span className="text-xs text-muted">item's assigned role{role ? ` · default ${role.name}` : ''}</span>
                  ) : role ? (
                    <Chip color={role.color}>{role.name}</Chip>
                  ) : (
                    <span className="text-xs text-subtle">humans</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Agent sessions" description="Every agent that has connected to this project, whichever client it used.">
        {!sessions.data?.length ? (
          <p className="flex items-center gap-2 text-[13px] text-subtle">
            <Plug className="size-4" /> No sessions yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-xs text-subtle">
                <tr>
                  <th className="py-2 pr-4 font-medium">Agent</th>
                  <th className="py-2 pr-4 font-medium">On behalf of</th>
                  <th className="py-2 pr-4 font-medium">Started</th>
                  <th className="py-2 pr-4 font-medium">Last seen</th>
                  <th className="py-2 pr-4 text-right font-medium">Tool calls</th>
                  <th className="py-2 text-right font-medium">Items done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sessions.data.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-1.5" title={s.clientName ?? undefined}>
                        <Terminal className="size-3.5 text-subtle" />
                        {s.agentName}
                        {s.online && <span className="size-1.5 rounded-full bg-success" />}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted">{s.userName}</td>
                    <td className="py-2 pr-4 text-muted">{formatDateTime(s.startedAt)}</td>
                    <td className="py-2 pr-4 text-muted">{timeAgo(s.lastSeenAt)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{s.toolCalls}</td>
                    <td className="py-2 text-right tabular-nums">{s.itemsCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
