import { EventEmitter } from 'node:events';
import type { ProjectEvent } from '@loop/shared';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const channel = (projectId: string) => `project:${projectId}`;

export function publish(projectId: string, event: ProjectEvent): void {
  emitter.emit(channel(projectId), event);
}

export function subscribe(projectId: string, listener: (event: ProjectEvent) => void): () => void {
  emitter.on(channel(projectId), listener);
  return () => emitter.off(channel(projectId), listener);
}

export function listenerCount(projectId: string): number {
  return emitter.listenerCount(channel(projectId));
}

/**
 * Collects events produced inside a database transaction so they are only published
 * after the transaction commits (never for rolled-back work).
 */
export class EventBatch {
  private readonly events: Array<[string, ProjectEvent]> = [];

  add(projectId: string, event: ProjectEvent): void {
    this.events.push([projectId, event]);
  }

  flush(): void {
    for (const [projectId, event] of this.events.splice(0)) publish(projectId, event);
  }
}
