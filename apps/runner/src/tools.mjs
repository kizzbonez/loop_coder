// The tools an API agent's model can call: Loop Coder's own MCP tools (except the two the
// runner calls itself) and local tools for files and commands in the agent's folders.
import path from 'node:path';
import { resolveAgentPath } from './paths.mjs';

/** The runner fetches work and waits itself, so a step's conversation stays about one step. */
export const RUNNER_ONLY_TOOLS = new Set(['get_next_work', 'wait_for_work']);

/** Tools after which a step is finished (the work was handed on, or a human must answer). */
export const FINISHING_TOOLS = new Set(['move_work_item', 'mark_refined', 'start_sprint', 'complete_sprint', 'complete_kickoff', 'request_human_input', 'release_work_item']);

const MAX_COMMAND_SECONDS = 600;

const localTools = (canRunCommands) => [
  {
    name: 'list_files',
    description: 'List a folder (paths are relative to the workspaces directory, e.g. "acme/shop/src"). Skips node_modules, .git and build output below the top level.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Folder to list' }, depth: { type: 'integer', minimum: 1, maximum: 4, description: 'How many levels (default 2)' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file, with line numbers. Long files: read further with offset.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File to read' },
        offset: { type: 'integer', minimum: 1, description: 'First line (default 1)' },
        limit: { type: 'integer', minimum: 1, maximum: 4000, description: 'Number of lines (default 2000)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content (creates missing folders). Prefer edit_file to change part of an existing file.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string', description: 'The complete new content' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace exact text in a file. old_text must match the file exactly (copy it from read_file without the line numbers) and appear once, unless replace_all is set.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  ...(canRunCommands
    ? [
        {
          name: 'run_command',
          description: `Run a shell command (sh) in one of your folders, for git, builds and tests. No internet access. Output is cut after 30,000 characters. Times out after timeout_seconds (default 120, at most ${MAX_COMMAND_SECONDS}); processes it leaves in the background are stopped.`,
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              cwd: { type: 'string', description: 'Folder to run in: the workspaces directory (the default, so paths in your instructions work as written) or one of your folders' },
              timeout_seconds: { type: 'integer', minimum: 1, maximum: MAX_COMMAND_SECONDS },
            },
            required: ['command'],
          },
        },
      ]
    : []),
];

/**
 * The tool set for one agent, and how to run a call.
 * @param {{ mcpTools: Array<{name: string, description?: string, inputSchema: object}>, callMcp: (name: string, args: object) => Promise<{text: string, isError: boolean}>, sandbox: ReturnType<import('./sandbox.mjs').createSandbox>, roots: string[], workspacesDir: string, canRunCommands: boolean, git: {name: string, email: string}, signal?: AbortSignal }} opts
 */
export function buildToolset(opts) {
  const { mcpTools, callMcp, sandbox, roots, workspacesDir, canRunCommands, git } = opts;
  const local = localTools(canRunCommands);
  const localNames = new Set(local.map((t) => t.name));
  const tools = [
    ...mcpTools.filter((t) => !RUNNER_ONLY_TOOLS.has(t.name) && !localNames.has(t.name)).map((t) => ({ name: t.name, description: (t.description ?? '').slice(0, 1000), inputSchema: t.inputSchema ?? { type: 'object', properties: {} } })),
    ...local,
  ];
  const mcpNames = new Set(tools.filter((t) => !localNames.has(t.name)).map((t) => t.name));

  /** Run one tool call. Never throws: failures come back as { isError: true }. */
  async function run(name, input = {}) {
    try {
      if (mcpNames.has(name)) return await callMcp(name, input);
      if (!localNames.has(name)) return { text: `Unknown tool ${name}.`, isError: true };
      if (name === 'run_command') {
        // The workspaces directory itself, or one of the agent's folders.
        const atTop = input.cwd === undefined || ['', '.', './', workspacesDir, `${workspacesDir}/`].includes(String(input.cwd).trim());
        const cwd = atTop ? { rel: '' } : resolveAgentPath(input.cwd, roots, workspacesDir);
        if (cwd.error) return { text: cwd.error, isError: true };
        if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 20_000) return { text: 'Give the command to run.', isError: true };
        const seconds = Math.min(Math.max(Number(input.timeout_seconds) || 120, 1), MAX_COMMAND_SECONDS);
        const r = await sandbox.command(input.command, { cwd: path.join(workspacesDir, cwd.rel), timeoutMs: seconds * 1000, git, signal: opts.signal });
        if (r.exitCode === -1 && r.output.startsWith('Could not start') && /ENOENT/.test(r.output)) {
          return { text: `The folder ${cwd.rel} does not exist yet: create it first (for example with mkdir -p from the workspaces directory).`, isError: true };
        }
        const head = r.timedOut ? `Timed out after ${seconds}s (stopped).` : `Exit code ${r.exitCode} (${(r.ms / 1000).toFixed(1)}s).`;
        return { text: `${head}\n${r.output || '(no output)'}`, isError: r.timedOut || r.exitCode !== 0 };
      }
      const target = resolveAgentPath(input.path, roots, workspacesDir);
      if (target.error) return { text: target.error, isError: true };
      const op = { list_files: 'list', read_file: 'read', write_file: 'write', edit_file: 'edit' }[name];
      const { depth, offset, limit, content, old_text, new_text, replace_all } = input;
      const result = await sandbox.fileOp({ op, rel: target.rel, roots, depth, offset, limit, content, old_text, new_text, replace_all });
      return result.ok ? { text: result.text, isError: false } : { text: result.error, isError: true };
    } catch (err) {
      return { text: `The tool failed: ${err?.message ?? err}`, isError: true };
    }
  }

  return { tools, run };
}
