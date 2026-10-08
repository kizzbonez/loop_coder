// The agent's connection to Loop Coder's MCP server, with its own access token.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AuthError } from './models.mjs';

const TOOL_TIMEOUT_MS = 2 * 60_000;

/** API agents announce themselves as "loop-api-agent/<name>", which the board shows as <name>. */
export const clientName = (agentName) => `loop-api-agent/${agentName}`;

export async function connectMcp({ url, token, agentName, version }) {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: clientName(agentName), version });
  try {
    await client.connect(transport);
  } catch (err) {
    throw /\b401\b|unauthori[sz]ed/i.test(String(err?.message)) ? new AuthError('The MCP server did not accept the agent’s token') : err;
  }
  return {
    async listTools() {
      return (await client.listTools()).tools;
    },
    /** Call a tool; resolves its text and whether it reported an error. */
    async call(name, args = {}, { signal, timeoutMs = TOOL_TIMEOUT_MS } = {}) {
      try {
        const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: timeoutMs });
        const text = (result.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
        return { text, isError: Boolean(result.isError) };
      } catch (err) {
        if (/\b401\b|unauthori[sz]ed/i.test(String(err?.message))) throw new AuthError('The MCP server did not accept the agent’s token');
        throw err;
      }
    },
    close: () => client.close().catch(() => {}),
  };
}
