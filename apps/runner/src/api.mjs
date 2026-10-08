// The runner's private API on Loop Coder (/llm, internal network only).

export function createRunnerApi({ apiUrl, secret, fetchImpl = fetch }) {
  const runnerHeaders = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
  return {
    /** Agents an administrator started, each with its access token. */
    async listAgents() {
      const res = await fetchImpl(`${apiUrl}/llm/runner/agents`, { headers: runnerHeaders, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(res.status === 401 ? 'The API rejected LOOP_RUNNER_SECRET (it must match the API’s)' : `Listing agents failed (${res.status})`);
      return (await res.json()).items;
    },
    async report(agentId, update) {
      const res = await fetchImpl(`${apiUrl}/llm/runner/agents/${agentId}/status`, { method: 'POST', headers: runnerHeaders, body: JSON.stringify(update), signal: AbortSignal.timeout(15_000) });
      if (!res.ok && res.status !== 404) throw new Error(`Status report failed (${res.status})`);
    },
    /** Tokens the agent has left today (0 when spent). */
    async budget(agent) {
      const res = await fetchImpl(`${apiUrl}/llm/agents/${agent.id}/budget`, { headers: { authorization: `Bearer ${agent.token}` }, signal: AbortSignal.timeout(15_000) });
      return res.ok ? (await res.json()).tokensLeftToday : 0;
    },
  };
}
