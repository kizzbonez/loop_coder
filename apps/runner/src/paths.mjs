// Where an API agent may read and write: its project folder and the project's worktrees folder,
// both relative to the workspaces directory (the paths Loop Coder's instructions use).
import path from 'node:path';

const posix = path.posix;

/** The two folders an agent of the project at `workspacePath` (e.g. "acme/shop") may use. */
export function agentRoots(workspacePath) {
  const project = posix.normalize(workspacePath).replace(/\/+$/, '');
  if (!project || project.startsWith('..') || posix.isAbsolute(project) || project.split('/').length !== 2) {
    throw new Error(`Unexpected project folder "${workspacePath}"`);
  }
  return [project, `${project}.worktrees`];
}

/**
 * A path the model gave, as a clean path relative to the workspaces directory, or an error
 * message when it points outside the agent's folders. Accepts "acme/shop/src/a.ts",
 * "/workspaces/acme/shop/src/a.ts" and "./acme/shop".
 */
export function resolveAgentPath(input, roots, workspacesDir = '/workspaces') {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1000 || input.includes('\0')) {
    return { error: 'Give a path relative to the workspaces directory, for example "' + roots[0] + '/README.md".' };
  }
  let p = input.replace(/\\/g, '/').trim();
  const prefix = workspacesDir.replace(/\/+$/, '') + '/';
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  if (posix.isAbsolute(p)) return { error: `Absolute paths are not allowed: use paths under ${roots.join(' or ')}.` };
  const rel = posix.normalize(p).replace(/\/+$/, '');
  const inside = roots.some((root) => rel === root || rel.startsWith(root + '/'));
  if (!inside || rel.split('/').includes('..')) return { error: `Outside your folders: use paths under ${roots.join(' or ')}.` };
  return { rel };
}
