// One API agent: fetches work from the board, lets its model do each step with the tools, and
// waits (without spending tokens) whenever the board is paused or has nothing for it.
import { agentRoots } from './paths.mjs';
import { buildToolset, FINISHING_TOOLS } from './tools.mjs';
import { AgentStoppedError, AuthError, BudgetError, ModelError } from './models.mjs';

const MAX_FAILURES = 3;
const BUDGET_CHECK_MS = 10 * 60_000;
const WAIT_SECONDS = 45;

/** STATUS: PAUSED|WAITING|STOPPED|COMPLETE|DISABLED, or null for work. */
export function parseStatus(text) {
  const match = /^STATUS: ([A-Z]+)\n?([^\n]*)/.exec(text);
  return match ? { status: match[1], message: match[2].trim() } : null;
}

/** "SHOP-3: you are acting as the Backend Developer" from the first line of the instructions. */
export function stepTitle(text) {
  return text.split('\n', 1)[0].replace(/^#+\s*/, '').replace(/\*\*/g, '').trim().slice(0, 200) || 'Working';
}

export function systemPrompt(agent, roots) {
  const commands = agent.canRunCommands
    ? `- \`run_command\` runs a shell command (sh), by default in the workspaces directory, for git, builds and tests. There is no internet access: installing packages from the internet fails, so use what is installed, or ask with \`request_human_input\` when you are blocked. Commits you make are authored as ${agent.git.name}.`
    : '- You cannot run commands: read and write files only. When a step needs commands (git, tests), say so with `request_human_input`.';
  return `You are "${agent.name}", an AI agent on the Loop Coder project ${agent.projectKey}. Loop Coder is an Agile/Scrum board; humans watch it live.

How you work:
- Each user message gives you one step: a work item at a stage, or a ceremony, with the role you play and step-by-step instructions. Follow them exactly and fully, and do the real work they describe.
- Finish the step with the tool the instructions name (\`move_work_item\`, \`mark_refined\`, \`start_sprint\`, \`complete_sprint\`, \`complete_kickoff\`, or \`request_human_input\` when only a human can unblock you). After that, call no more tools: the runner gives you the next step. Do not call \`get_next_work\` or \`wait_for_work\`; the runner does.
- Files: paths are relative to the Loop Coder workspaces directory, exactly as the instructions write them. You may use only ${roots.map((r) => `\`${r}\``).join(' and ')}. Use \`list_files\`, \`read_file\`, \`write_file\` and \`edit_file\`.
${commands}
- Never work in another agent's worktree, and never remove or prune worktrees you did not create.
- You have at most ${agent.maxTurnsPerStep} rounds of tool calls per step: read only what you need, and make independent calls together.
- Keep remarks and \`log_progress\` notes short and factual.`;
}

export class AgentWorker {
  /**
   * @param {object} agent What the API gives the runner for this agent (see runnerAgents()).
   * @param {{ api: object, connectMcp: Function, createModel: Function, sandbox: object, workspacesDir: string, mcpUrl: string, version: string, log: object, sleep?: Function }} deps
   */
  constructor(agent, deps) {
    this.agent = agent;
    this.deps = deps;
    this.controller = new AbortController();
    this.sleep = deps.sleep ?? ((ms, signal) => new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    }));
    this.mcp = null;
    this.mcpTools = null;
    this.lastReport = '';
  }

  get stopped() {
    return this.controller.signal.aborted;
  }

  /** New settings from the API (a renewed token, another model, other limits). */
  update(agent) {
    // The board knows the agent by the name it connected with.
    const reconnect = agent.token !== this.agent.token || agent.name !== this.agent.name;
    this.agent = agent;
    if (reconnect) this.disconnect();
  }

  stop() {
    this.controller.abort();
    this.disconnect();
  }

  disconnect() {
    if (this.mcp) void this.mcp.close();
    this.mcp = null;
    this.mcpTools = null;
  }

  async report(update) {
    const key = JSON.stringify(update);
    if (key === this.lastReport) return;
    this.lastReport = key;
    try {
      await this.deps.api.report(this.agent.id, update);
    } catch (err) {
      this.deps.log.warn({ agent: this.agent.id, err: err.message }, 'status report failed');
    }
  }

  async connection() {
    if (!this.mcp) {
      this.mcp = await this.deps.connectMcp({ url: this.deps.mcpUrl, token: this.agent.token, agentName: this.agent.name, version: this.deps.version });
      this.mcpTools = await this.mcp.listTools();
    }
    return this.mcp;
  }

  async boardCall(name, args, options) {
    const mcp = await this.connection();
    const result = await mcp.call(name, { project: this.agent.projectKey, ...args }, options);
    if (result.isError) throw new ModelError(`${name}: ${result.text.slice(0, 300)}`);
    return result.text;
  }

  /** The agent's main loop; resolves when it is stopped or stops itself. */
  async run() {
    const signal = this.controller.signal;
    let failures = 0;
    await this.report({ activity: 'Connecting to the board…', error: null });
    while (!this.stopped) {
      try {
        let text = await this.boardCall('get_next_work');
        let status = parseStatus(text);
        while (status && (status.status === 'PAUSED' || status.status === 'WAITING') && !this.stopped) {
          await this.report({ activity: `${status.status === 'PAUSED' ? 'Paused' : 'Waiting'}: ${status.message}`.slice(0, 300), error: null });
          text = await this.boardCall('wait_for_work', { seconds: WAIT_SECONDS }, { signal, timeoutMs: (WAIT_SECONDS + 30) * 1000 });
          status = parseStatus(text);
        }
        if (this.stopped) break;
        if (status) {
          const why = { STOPPED: 'Stopped from the board', COMPLETE: 'The project is complete', DISABLED: 'Agents are disabled for this project' }[status.status] ?? status.message;
          await this.report({ activity: why, error: null, stopped: true });
          return;
        }
        await this.step(text);
        failures = 0;
      } catch (err) {
        if (this.stopped || err instanceof AgentStoppedError) break;
        if (err instanceof BudgetError) {
          await this.report({ activity: 'Waiting for tomorrow’s token budget (UTC)', error: `Daily token limit reached: ${err.message}`.slice(0, 500) });
          await this.waitForBudget();
          continue;
        }
        if (err instanceof AuthError) {
          // The API replaces a rejected token on the runner's next poll.
          this.disconnect();
          await this.report({ activity: 'Renewing its access…', error: null });
          await this.sleep(15_000, signal);
          continue;
        }
        failures += 1;
        const message = String(err?.message ?? err).slice(0, 450);
        this.deps.log.warn({ agent: this.agent.id, failures, err: message }, 'agent step failed');
        this.disconnect();
        if (failures >= MAX_FAILURES) {
          await this.report({ activity: 'Stopped after repeated failures', error: message, stopped: true });
          return;
        }
        await this.report({ activity: `Retrying in ${30 * failures}s`, error: message });
        await this.sleep(30_000 * failures, signal);
      }
    }
  }

  async waitForBudget() {
    while (!this.stopped) {
      await this.sleep(BUDGET_CHECK_MS, this.controller.signal);
      try {
        if ((await this.deps.api.budget(this.agent)) > 0) return;
      } catch {
        /* try again later */
      }
    }
  }

  /** One step: a fresh conversation with the step's instructions, until a finishing tool succeeds. */
  async step(instructions) {
    const agent = this.agent;
    const roots = agentRoots(agent.workspacePath);
    await this.report({ activity: stepTitle(instructions), error: null });
    const mcp = await this.connection();
    const toolset = buildToolset({
      mcpTools: this.mcpTools,
      callMcp: (name, args) => mcp.call(name, args, { signal: this.controller.signal }),
      sandbox: this.deps.sandbox,
      roots,
      workspacesDir: this.deps.workspacesDir,
      canRunCommands: agent.canRunCommands,
      git: agent.git,
      signal: this.controller.signal,
    });
    const conversation = this.deps.createModel(agent).conversation(systemPrompt(agent, roots), instructions, toolset.tools);
    let reminded = false;
    for (let round = 1; round <= agent.maxTurnsPerStep; round++) {
      if (this.stopped) return;
      const reply = await conversation.next();
      if (reply.stopReason === 'refusal') throw new ModelError('The model declined this step.');
      if (reply.calls.length === 0) {
        if (reply.stopReason === 'max_tokens') {
          conversation.nudge('Your reply was cut off. Continue, in smaller pieces.');
          continue;
        }
        if (reminded) throw new ModelError(`The model stopped without finishing the step${reply.text ? `: “${reply.text.slice(0, 200)}”` : ''}`);
        reminded = true;
        conversation.nudge('This step is not finished yet. Finish it with the tool the instructions name, or call `request_human_input` if only a human can unblock you.');
        continue;
      }
      const results = [];
      let finished = false;
      for (const call of reply.calls) {
        if (this.stopped) return;
        let result;
        if (reply.stopReason === 'max_tokens') result = { text: 'Your reply was cut off before this call was complete: make it again, smaller.', isError: true };
        else if (call.input?.__invalid_json) result = { text: 'The arguments were not valid JSON: call the tool again.', isError: true };
        else result = await toolset.run(call.name, call.input);
        results.push({ id: call.id, ...result });
        if (FINISHING_TOOLS.has(call.name) && !result.isError) finished = true;
      }
      if (finished) return;
      conversation.addResults(results);
    }
    throw new ModelError(`It used all ${agent.maxTurnsPerStep} tool rounds without finishing the step.`);
  }
}
