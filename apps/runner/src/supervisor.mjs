// Keeps one worker per running API agent: starts the ones an administrator started, passes on
// new settings, and stops the ones that were stopped or deleted.

/** A worker that ended on its own is not restarted before this, even if the API still lists it. */
const RESTART_AFTER_MS = 60_000;

export function createSupervisor({ api, makeWorker, log, now = Date.now }) {
  const workers = new Map();
  const ended = new Map();

  async function tick() {
    let items;
    try {
      items = await api.listAgents();
    } catch (err) {
      log.warn({ err: err.message }, 'cannot list API agents');
      return;
    }
    const listed = new Set(items.map((a) => a.id));
    for (const [id, worker] of workers) {
      if (!listed.has(id)) {
        worker.stop();
        workers.delete(id);
        log.info({ agent: id }, 'API agent stopped');
      }
    }
    for (const [id] of ended) if (!listed.has(id)) ended.delete(id);
    for (const agent of items) {
      const current = workers.get(agent.id);
      if (current) {
        current.update(agent);
        continue;
      }
      if (ended.has(agent.id) && now() - ended.get(agent.id) < RESTART_AFTER_MS) continue;
      const worker = makeWorker(agent);
      workers.set(agent.id, worker);
      log.info({ agent: agent.id, name: agent.name, provider: agent.providerKind, model: agent.model }, 'API agent started');
      void worker
        .run()
        .catch((err) => log.error({ agent: agent.id, err: err.message }, 'API agent crashed'))
        .finally(() => {
          if (workers.get(agent.id) === worker) {
            workers.delete(agent.id);
            ended.set(agent.id, now());
          }
        });
    }
  }

  function stopAll() {
    for (const worker of workers.values()) worker.stop();
    workers.clear();
  }

  return { tick, stopAll, workers };
}
