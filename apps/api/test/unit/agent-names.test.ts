import { describe, expect, it } from 'vitest';
import { agentDisplayName } from '@loop/shared';

describe('agentDisplayName (MCP clientInfo → board label)', () => {
  it.each([
    ['claude-code 2.1.0', 'Claude Code'],
    ['Claude Code', 'Claude Code'],
    ['claude-ai 0.1', 'Claude'],
    ['cursor-vscode 1.0.0', 'Cursor'],
    ['Cursor v1.4', 'Cursor'],
    ['Visual Studio Code 1.104.0', 'VS Code'],
    ['github-copilot 0.9', 'Copilot'],
    ['windsurf-client 1.2', 'Windsurf'],
    ['Cline 3.20.0', 'Cline'],
    ['roo-code 3.1', 'Roo Code'],
    ['codex-mcp-client 0.40.0', 'Codex'],
    ['gemini-cli-mcp-client 0.1.0', 'Gemini'],
    ['goose 1.0', 'Goose'],
    ['zed 0.200', 'Zed'],
    ['continue-client 1.0', 'Continue'],
  ])('%j → %s', (client, label) => {
    expect(agentDisplayName(client)).toBe(label);
  });

  it('falls back to a tidy version of unknown names', () => {
    expect(agentDisplayName('my-custom_agent 2.0.1')).toBe('My Custom Agent');
    expect(agentDisplayName('acme bot')).toBe('Acme Bot');
  });

  it('calls API agents by the name their administrator gave them', () => {
    expect(agentDisplayName('loop-api-agent/Gemini builder 0.9.0')).toBe('Gemini builder');
    expect(agentDisplayName('loop-api-agent/QA bot 2')).toBe('QA bot 2');
    expect(agentDisplayName('loop-api-agent/ 0.9.0')).toBe('Agent');
  });

  it('uses "Agent" when the client is unknown', () => {
    expect(agentDisplayName(null)).toBe('Agent');
    expect(agentDisplayName(undefined)).toBe('Agent');
    expect(agentDisplayName('')).toBe('Agent');
    expect(agentDisplayName('   ')).toBe('Agent');
  });

  it('does not over-match substrings', () => {
    expect(agentDisplayName('authorized-tool 1.0')).toBe('Authorized Tool');
    expect(agentDisplayName('broom 1.0')).toBe('Broom');
  });

  it('caps very long names', () => {
    expect(agentDisplayName('x'.repeat(200)).length).toBeLessThanOrEqual(40);
  });
});
