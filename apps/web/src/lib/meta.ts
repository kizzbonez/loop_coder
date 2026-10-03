import { Bug, FlaskConical, Layers, SquareCheck, BookOpen, type LucideIcon } from 'lucide-react';
import type { ItemType, Priority, RemarkKind } from '@loop/shared';

export const ITEM_TYPE_META: Record<ItemType, { label: string; icon: LucideIcon; color: string }> = {
  epic: { label: 'Epic', icon: Layers, color: '#a855f7' },
  story: { label: 'Story', icon: BookOpen, color: '#22c55e' },
  task: { label: 'Task', icon: SquareCheck, color: '#3b82f6' },
  bug: { label: 'Bug', icon: Bug, color: '#ef4444' },
  spike: { label: 'Spike', icon: FlaskConical, color: '#f59e0b' },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string; bars: number }> = {
  critical: { label: 'Critical', color: '#ef4444', bars: 4 },
  high: { label: 'High', color: '#f97316', bars: 3 },
  medium: { label: 'Medium', color: '#eab308', bars: 2 },
  low: { label: 'Low', color: '#64748b', bars: 1 },
};

export const REMARK_KIND_META: Record<RemarkKind, { label: string; color: string }> = {
  comment: { label: 'Comment', color: '#64748b' },
  work_log: { label: 'Work log', color: '#3b82f6' },
  design: { label: 'Design', color: '#ec4899' },
  review: { label: 'Code review', color: '#f59e0b' },
  test_report: { label: 'Test report', color: '#14b8a6' },
  question: { label: 'Question', color: '#ef4444' },
  answer: { label: 'Answer', color: '#22c55e' },
  system: { label: 'System', color: '#8b5cf6' },
};

export const ACCESS_LABEL: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
  admin: 'Admin',
};

/** Translucent background for a hex colour (used for chips). */
export function tint(hex: string, alpha = 0.14): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}
