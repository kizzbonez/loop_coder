import { itemBranch, type ColumnKind, type GitMode } from '@loop/shared';
import type { Actor } from '../../lib/actor';

/** Where an agent works and on which branch; null in shared mode (everyone in the project folder). */
export interface GitContext {
  /** The project folder (main checkout on the base branch), relative to the workspaces directory. */
  repo: string;
  /** This agent's own worktree, relative to the workspaces directory. */
  worktree: string;
  /** The same worktree relative to the project folder (for `git -C <repo> worktree add`). */
  worktreeFromRepo: string;
  base: string;
  /** The work item's branch, when the step is about an item. */
  branch: string | null;
}

/** "Dev laptop" → "dev-laptop": only [a-z0-9-], so it is safe in paths and shell commands. */
export function slugify(text: string, max = 30): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '') // accents: "ü" becomes "u"
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'agent'
  );
}

/** One folder per agent (per access token): its name plus a short id, e.g. "dev-laptop-3f9a2c". */
export function agentFolder(actor: Actor): string {
  const id = (actor.tokenId ?? actor.userId).replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase();
  return `${slugify(actor.tokenName ?? actor.agentName ?? 'agent')}-${id}`;
}

export function gitContext(
  project: { key: string; gitMode: GitMode; baseBranch: string },
  workspacePath: string,
  actor: Actor,
  taskKey: string | null,
): GitContext | null {
  if (project.gitMode !== 'worktrees') return null;
  const folder = agentFolder(actor);
  const projectFolder = workspacePath.split('/').pop()!;
  const parent = workspacePath.slice(0, -projectFolder.length);
  return {
    repo: workspacePath,
    worktree: `${parent}${projectFolder}.worktrees/${folder}`,
    worktreeFromRepo: `../${projectFolder}.worktrees/${folder}`,
    base: project.baseBranch,
    branch: taskKey ? itemBranch(taskKey) : null,
  };
}

/** Getting the agent's own worktree ready (every step that touches code starts here). */
function setup(g: GitContext): string {
  return `**Your own git worktree** (other agents may be working at the same time; never work in another agent's folder):
- Project folder (stays on \`${g.base}\`, holds only finished work): \`${g.repo}\`
- Your worktree: \`${g.worktree}\` (paths are relative to the Loop Coder workspaces directory)

If your worktree does not exist yet, create it: \`git -C ${g.repo} worktree add --detach ${g.worktreeFromRepo} ${g.base}\`. If the project folder is not a git repository yet, first create it there with \`git init -b ${g.base}\` and an initial commit (for example a README).`;
}

/** The merge that finishes an item: into the base branch, in the project folder. */
function merge(g: GitContext, taskKey: string): string {
  return `**Merge before you move it to \`done\`:**
1. \`git -C ${g.repo} merge --no-ff ${g.branch} -m "${taskKey}: merge ${g.branch}"\` (the project folder must be on \`${g.base}\` with no uncommitted changes; if a human left changes there, ask with \`request_human_input\` instead).
2. If the merge conflicts, run \`git -C ${g.repo} merge --abort\` and move the item back to \`in_progress\` asking the developer to merge \`${g.base}\` into \`${g.branch}\` and resolve the conflicts. If git reports that another git process is running, wait a few seconds and try again.
3. Run the tests in the project folder, then delete the branch: \`git -C ${g.repo} branch -d ${g.branch}\`.
4. Mention the merge commit in your remark.`;
}

/** Git steps for a stage in worktree mode. */
export function gitGuidance(kind: ColumnKind, g: GitContext, taskKey: string): string | null {
  const b = g.branch!;
  switch (kind) {
    case 'todo':
    case 'in_progress':
      return `## Git: worktree and branch
${setup(g)}

1. In your worktree, take the item's branch: \`git switch ${b}\`, or create it the first time with \`git switch -c ${b} ${g.base}\`. If git says the branch is checked out in another worktree, run \`git -C ${g.repo} worktree list\` and ask with \`request_human_input\` rather than touching that folder.
2. Bring in the latest finished work: \`git merge ${g.base}\`; resolve any conflicts and run the tests.
3. Commit your work on \`${b}\` with messages that start with \`${taskKey}\`.
4. Before \`move_work_item\`: commit everything, then let go of the branch with \`git switch --detach\` so the next agent can take it.`;
    case 'review':
      return `## Git: worktree and branch
${setup(g)}

Review the branch without taking it over: \`git log ${g.base}..${b}\` and \`git diff ${g.base}...${b}\`. To run it, check it out detached in your worktree: \`git switch --detach ${b}\`. Do not commit to it; request changes instead.

If you approve straight to \`done\` (no QA needed), merge it first.
${merge(g, taskKey)}`;
    case 'testing':
      return `## Git: worktree and branch
${setup(g)}

Test the branch in your worktree, detached: \`git switch --detach ${b}\`, then install and run the full test suite there. Do not commit to it; report failures instead.

On **pass**:
${merge(g, taskKey)}`;
    default:
      return null;
  }
}

/** A short note for steps that do not touch code (refinement, ceremonies). */
export function gitNote(g: GitContext): string {
  return `## Git\nThis project uses one git worktree per agent and a branch per work item (\`item/<KEY>\`), merged into \`${g.base}\` in the project folder \`${g.repo}\` when the item is done. Your worktree is \`${g.worktree}\`. Do not edit code in this step.`;
}
