/**
 * Friendly names for MCP clients, derived from the `clientInfo.name` they send when they
 * connect (stored as "<name> <version>"). Loop Coder works with any MCP coding agent; the
 * board labels its actions with the client's name, or "Agent" when it is unknown.
 */
const KNOWN_CLIENTS: Array<[RegExp, string]> = [
  [/claude[-_\s]?code/i, 'Claude Code'],
  [/claude/i, 'Claude'],
  [/cursor/i, 'Cursor'],
  [/copilot/i, 'Copilot'],
  [/visual[-_\s]?studio[-_\s]?code|\bvs[-_\s]?code\b/i, 'VS Code'],
  [/windsurf|codeium/i, 'Windsurf'],
  [/\broo[-_\s]?code\b/i, 'Roo Code'],
  [/\bcline\b/i, 'Cline'],
  [/\bcodex\b/i, 'Codex'],
  [/\bgemini\b/i, 'Gemini'],
  [/\bgoose\b/i, 'Goose'],
  [/^zed\b/i, 'Zed'],
  [/\bcontinue\b/i, 'Continue'],
  [/\bopencode\b/i, 'opencode'],
];

export const GENERIC_AGENT_NAME = 'Agent';

export function agentDisplayName(clientName?: string | null): string {
  if (!clientName) return GENERIC_AGENT_NAME;
  // Drop a trailing version ("claude-code 2.1.0", "Cursor v1.2").
  const base = clientName.trim().replace(/\s+v?\d+(?:\.\d+)*\S*$/i, '').trim();
  for (const [pattern, label] of KNOWN_CLIENTS) if (pattern.test(base)) return label;
  const pretty = base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim()
    .slice(0, 40);
  return pretty || GENERIC_AGENT_NAME;
}
