import {
  CalendarRange,
  CircleCheck,
  CircleDashed,
  Coffee,
  Code,
  FlaskConical,
  GitPullRequest,
  HandHelping,
  ListTodo,
  Presentation,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import type { EdgeKind, StageId } from '../../../lib/flow/model';

export const STAGE_ICONS: Record<StageId, LucideIcon> = {
  backlog: ListTodo,
  todo: CircleDashed,
  in_progress: Code,
  review: GitPullRequest,
  testing: FlaskConical,
  done: CircleCheck,
  blocked: HandHelping,
  kickoff: Rocket,
  sprint_planning: CalendarRange,
  sprint_review: Presentation,
  lounge: Coffee,
};

/** Arrow and colour family per kind of path. */
export type EdgeTone = 'base' | 'rework' | 'human' | 'ceremony';

export function edgeTone(kind: EdgeKind): EdgeTone {
  switch (kind) {
    case 'rework':
    case 'reopen':
      return 'rework';
    case 'escalate':
    case 'resolve':
      return 'human';
    case 'ceremony':
    case 'loop':
      return 'ceremony';
    default:
      return 'base';
  }
}

export const EDGE_TONES: readonly EdgeTone[] = ['base', 'rework', 'human', 'ceremony'];

/** Short human description of a flow event, for the feed and screen readers. */
export function describeFlowAction(action: string): string {
  switch (action) {
    case 'task.created':
      return 'created';
    case 'task.moved':
      return 'moved';
    case 'task.escalated':
      return 'escalated';
    case 'task.started':
      return 'started';
    case 'task.refined':
      return 'refined';
    case 'ceremony.started':
      return 'ceremony';
    case 'project.kickoff_completed':
      return 'kickoff done';
    case 'sprint.started':
      return 'sprint started';
    case 'sprint.completed':
      return 'sprint completed';
    default:
      return action;
  }
}
