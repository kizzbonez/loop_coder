import { describe, expect, it } from 'vitest';
import { loopInstructions } from './AgentView';

describe('loopInstructions (for MCP clients without prompt support)', () => {
  const text = loopInstructions('SHOP');

  it('targets the project and the loopcoder tools', () => {
    expect(text).toContain('project "SHOP"');
    expect(text).toContain('"loopcoder" MCP tools');
    expect(text).toContain('get_next_work');
  });

  it('names every tool that finishes a step and the stop conditions', () => {
    for (const tool of ['move_work_item', 'mark_refined', 'start_sprint', 'complete_sprint', 'complete_kickoff', 'request_human_input']) {
      expect(text).toContain(tool);
    }
    expect(text).toMatch(/COMPLETE, PAUSED or WAITING/);
  });

  it('is client-neutral', () => {
    expect(text).not.toMatch(/Claude/);
  });
});
