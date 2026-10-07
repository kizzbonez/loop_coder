// What people say in the agent office: short spoken lines derived from activity and remarks.
import type { ActivityDTO, RemarkDTO } from '@loop/shared';
import type { BubbleTone } from './sim';

export interface ChatLine {
  id: string;
  at: string;
  speaker: { kind: 'agent' | 'user' | 'system'; name: string };
  roleKey: string | null;
  text: string;
  tone: BubbleTone;
  /** Sound to accompany the line, if any. */
  cue?: 'chime' | 'jingle' | 'fanfare';
}

/** Markdown → one short spoken sentence: no code blocks, links as text, at most `max` characters. */
export function speech(markdown: string, max = 140): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}

const CEREMONY_LINES: Record<string, string> = {
  kickoff: 'Kickoff time! Let me read the goal and build the backlog.',
  sprint_planning: "Sprint planning: let's pick what we can finish.",
  sprint_review: "Sprint review: let's look at what we shipped.",
};

/** A spoken line for an activity, or null when it is not worth saying out loud. */
export function lineFromActivity(a: ActivityDTO, stageName: (kind: string) => string): ChatLine | null {
  const name = a.actorName ?? 'System';
  const speaker = { kind: a.actorType, name };
  const base = { id: `a:${a.id}`, at: a.createdAt, speaker, roleKey: a.roleKey };
  const key = a.taskKey ?? 'it';
  switch (a.action) {
    case 'agent.progress':
      return { ...base, text: speech(a.message), tone: 'say' };
    case 'task.started':
      return { ...base, text: `On it: ${key}.`, tone: 'say' };
    case 'task.moved':
      if (!a.toKind) return null;
      if (a.toKind === 'done') return { ...base, text: `${key} is done!`, tone: 'say', cue: 'jingle' };
      if (a.toKind === 'blocked') return { ...base, text: `I need a human for ${key}.`, tone: 'question', cue: 'chime' };
      if (a.fromKind === 'review' && a.toKind === 'in_progress') return { ...base, text: `${key} needs changes. Back to the workshop!`, tone: 'say' };
      if (a.fromKind === 'testing' && a.toKind === 'in_progress') return { ...base, text: `Found a bug in ${key}. Back it goes!`, tone: 'say' };
      if (a.fromKind === 'backlog' && a.toKind === 'todo' && a.actorType === 'agent') return null; // said once by "sprint started"
      return { ...base, text: `${key} → ${stageName(a.toKind)}.`, tone: 'say' };
    case 'task.escalated':
      return { ...base, text: `I'm stuck on ${key}. Can a human help?`, tone: 'question', cue: 'chime' };
    case 'task.refined':
      return { ...base, text: `${key} is ready for planning.`, tone: 'say' };
    case 'ceremony.started':
      return a.ceremony ? { ...base, text: CEREMONY_LINES[a.ceremony] ?? speech(a.message), tone: 'say', cue: 'fanfare' } : null;
    case 'project.kickoff_completed':
      return { ...base, text: 'The backlog is ready!', tone: 'say', cue: 'jingle' };
    case 'sprint.started':
      return { ...base, text: speech(a.message.replace(/^.*?started /, 'Starting ')), tone: 'say', cue: 'fanfare' };
    case 'sprint.completed':
      return { ...base, text: 'Sprint complete! Great work, team.', tone: 'say', cue: 'jingle' };
    case 'agent.paused':
    case 'agent.resumed':
      return { ...base, text: a.action === 'agent.paused' ? 'Pausing the agents.' : 'Agents, back to work!', tone: 'answer' };
    default:
      return null;
  }
}

/** A spoken line for a remark: agents read out their notes, people their answers. */
export function lineFromRemark(r: RemarkDTO): ChatLine | null {
  if (r.kind === 'system') return null;
  const speaker = { kind: r.authorType, name: r.authorName ?? (r.authorType === 'agent' ? 'Agent' : 'Someone') };
  const tone: BubbleTone = r.kind === 'question' ? 'question' : r.authorType === 'user' ? 'answer' : 'say';
  return { id: `r:${r.id}`, at: r.createdAt, speaker, roleKey: r.roleKey, text: speech(r.body), tone, cue: r.kind === 'question' ? 'chime' : undefined };
}
