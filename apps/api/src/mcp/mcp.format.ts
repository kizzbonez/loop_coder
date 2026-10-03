import type { RemarkDTO, TaskDetailDTO, TaskDTO } from '@loop/shared';

const MAX_REMARKS = 25;

function remarkLine(r: RemarkDTO): string {
  const who = r.authorType === 'agent' ? `${r.authorName ?? 'Agent'}${r.roleKey ? ` (${r.roleKey})` : ''}` : (r.authorName ?? r.authorType);
  return `#### ${who} · ${r.kind} · ${r.createdAt.slice(0, 16).replace('T', ' ')} UTC\n${r.body}`;
}

/** Render a work item (with its remark thread) as markdown for the agent. */
export function formatTaskDetail(
  task: TaskDetailDTO,
  ctx: { columnName: string; roleName?: string; keyById: Map<string, { key: string; done: boolean }> },
): string {
  const deps = task.dependsOn.map((id) => {
    const d = ctx.keyById.get(id);
    return d ? `${d.key}${d.done ? ' (done)' : ' (open)'}` : id;
  });
  const parent = task.parentId ? (ctx.keyById.get(task.parentId)?.key ?? task.parentId) : null;
  const remarks = task.remarks.slice(-MAX_REMARKS);
  const omitted = task.remarks.length - remarks.length;

  return [
    `## Work item ${task.key}: ${task.title}`,
    [
      `- Type: ${task.type} · Priority: ${task.priority} · Story points: ${task.storyPoints ?? 'not estimated'}`,
      `- Stage: ${ctx.columnName}${ctx.roleName ? ` · Role: ${ctx.roleName}` : ''} · Refined: ${task.refined ? 'yes' : 'no'}`,
      parent ? `- Parent epic: ${parent}` : '',
      deps.length ? `- Depends on: ${deps.join(', ')}` : '',
      task.labels.length ? `- Labels: ${task.labels.join(', ')}` : '',
      task.bounceCount ? `- Sent back for rework ${task.bounceCount} time(s)` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    `### Description\n${task.description || '_empty_'}`,
    `### Acceptance criteria\n${task.acceptanceCriteria || '_none yet_'}`,
    `### Remarks (${task.remarks.length})${omitted > 0 ? ` (oldest ${omitted} omitted)` : ''}\n${remarks.map(remarkLine).join('\n\n') || '_none_'}`,
  ].join('\n\n');
}

export function formatTaskRow(task: TaskDTO, columnName: string): string {
  return `- **${task.key}** [${task.type} · ${task.priority} · ${task.storyPoints ?? '?'} pts · ${columnName}${task.refined ? '' : ' · unrefined'}${task.claim ? ' · claimed' : ''}] ${task.title}`;
}
