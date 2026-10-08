import type { ColumnKind } from '@loop/shared';
import type { AgentRoleRow, ColumnRow, ProjectRow } from '../../db/schema';

/** Stage-specific guidance: what to do in this column and how to hand the item on. */
const STAGE_GUIDANCE: Partial<Record<ColumnKind, string>> = {
  backlog: `This item is in the **Backlog** and must be refined until it meets the Definition of Ready.
1. Read the item and every remark. For an **epic**, break it into child stories with \`create_work_items\` (set \`parent\` to this epic's key), then mark the epic refined.
2. Rewrite it as a clear user story (or task/bug/spike description) with specific, testable acceptance criteria (Given/When/Then bullets).
3. Estimate story points (1, 2, 3, 5, 8). If it is bigger than 8 points, split it into smaller items with \`create_work_items\`.
4. Choose \`assigned_role\` for the implementation stage and record \`depends_on\` for anything that must be finished first.
5. Save the improvements with \`update_work_item\`, then call \`mark_refined\` with a one-line summary.
If only a human can answer an open question, call \`request_human_input\` with a precise question instead.`,

  todo: `This item is committed to the sprint and is now yours to implement.
- Read the remarks first. If it came back from review or QA, address **every** point raised.
- Post short progress notes with \`log_progress\` while you work; they appear live on the board.
- When the work is complete and verified locally, call \`move_work_item\` to \`review\` with a remark covering what changed, files touched, how to verify, and the tests you ran with their results.
- If something only a human can resolve blocks you, call \`request_human_input\`.`,

  review: `Review the implementation of this item (inspect the actual changes, for example with git log/diff for commits mentioning the item key).
- **Approve:** \`move_work_item\` to \`testing\` with your review summary (\`kind: "review"\`). Items that need no QA (design documents, documentation, spikes) may go straight to \`done\`.
- **Request changes:** \`move_work_item\` to \`in_progress\` with a numbered, actionable list of required changes (\`kind: "review"\`).`,

  testing: `Verify this item against every acceptance criterion and the Definition of Done. Run the full automated test suite.
- **Pass:** \`move_work_item\` to \`done\` with a test report (\`kind: "test_report"\`) that lists each acceptance criterion with pass/fail.
- **Fail:** \`move_work_item\` to \`in_progress\` with reproduction steps, expected vs. actual results (\`kind: "test_report"\`).
- Defects unrelated to this item: create separate \`bug\` items in the backlog with \`create_work_items\`.`,
};
STAGE_GUIDANCE.in_progress = STAGE_GUIDANCE.todo;

const LOOP_FOOTER = `---
When this step is finished, call \`get_next_work\` again to continue the loop. Never move an item forward without doing the work it describes.`;

export function taskInstructions(opts: {
  project: ProjectRow;
  column: ColumnRow;
  role: AgentRoleRow;
  taskKey: string;
  workspacePath: string;
}): string {
  const { project, column, role, taskKey, workspacePath } = opts;
  const definition =
    column.kind === 'backlog'
      ? `## Definition of Ready\n${project.definitionOfReady || '_Not defined._'}`
      : `## Definition of Done\n${project.definitionOfDone || '_Not defined._'}`;
  return [
    `# ${taskKey}: you are acting as the **${role.name}**`,
    `Project **${project.name}** (${project.key}). Work in the project repository folder \`${workspacePath}\` (create it if it does not exist).`,
    `## Your role\n${role.instructions}`,
    `## Current stage: ${column.name}\n${STAGE_GUIDANCE[column.kind] ?? 'Do the work this stage requires, then move the item on with `move_work_item`.'}`,
    definition,
    project.notes ? `## Project notes (shared memory)\n${project.notes}` : '',
    LOOP_FOOTER,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function kickoffInstructions(opts: { project: ProjectRow; role: AgentRoleRow; workspacePath: string; existingItems: number }): string {
  const { project, role, workspacePath, existingItems } = opts;
  return `# Project kickoff: you are acting as the **${role.name}**

## Project goal / requirements
${project.description || '_The project has no description yet. Use request_human_input on a "Clarify project goal" item if you cannot proceed._'}

## Your role
${role.instructions}

## Steps
1. Understand the goal. If the repository folder \`${workspacePath}\` already contains code, inspect it first.
2. Define the product vision, the scope (in and out), the main user types and the high-level technical direction.
3. Record these decisions, assumptions and conventions with \`update_project_notes\`. This is the team's shared memory.
4. Build the initial product backlog with \`create_work_items\`:
   - epics for the major capabilities, with user stories beneath them (\`parent\` = the epic's ref or key);
   - foundation work first: repository and tooling setup, architecture (\`architect\`), design system and key screens (\`ui_designer\`); then features; then hardening (\`security_engineer\`), CI/CD (\`devops_engineer\`) and documentation (\`tech_writer\`);
   - set \`refined: true\` only for items that already meet the Definition of Ready, and set \`depends_on\` where order matters.
5. For questions only a human can answer, create a spike item and call \`request_human_input\` on it. Otherwise make a reasonable assumption and note it.
6. Call \`complete_kickoff\` with a short summary.
${existingItems > 0 ? `\nNote: the board already has ${existingItems} work item(s) created by humans. Review them and fit them into the backlog instead of duplicating them.\n` : ''}
## Definition of Ready
${project.definitionOfReady}

${LOOP_FOOTER}`;
}

export function planningInstructions(opts: {
  project: ProjectRow;
  role: AgentRoleRow;
  candidates: string;
  carryOver: string;
}): string {
  const { project, role, candidates, carryOver } = opts;
  return `# Sprint planning: you are acting as the **${role.name}**

Capacity: about **${project.sprintCapacity} story points** per sprint.

## Refined backlog items (highest priority first)
${candidates || '_None._'}
${carryOver ? `\n## Unfinished work carried over (joins the new sprint automatically)\n${carryOver}\n` : ''}
## Steps
1. Formulate one clear **sprint goal**: the outcome this sprint delivers.
2. Select the highest-value items that serve the goal, whose dependencies are done or are also selected, up to the capacity (count carried-over work).
3. Call \`start_sprint\` with the goal and the selected item keys (and optionally a name).

${project.notes ? `## Project notes\n${project.notes}\n\n` : ''}${LOOP_FOOTER}`;
}

export function reviewInstructions(opts: {
  project: ProjectRow;
  role: AgentRoleRow;
  sprintName: string;
  sprintGoal: string;
  done: string;
  notDone: string;
}): string {
  const { role, sprintName, sprintGoal, done, notDone } = opts;
  return `# Sprint review and retrospective for ${sprintName}: you are acting as the **${role.name}**

Sprint goal: ${sprintGoal || '_none recorded_'}

## Delivered
${done || '_Nothing was completed._'}

## Not finished
${notDone || '_Everything was completed._'}

## Steps
1. **Sprint review:** summarise what was delivered against the goal, including any scope changes and the demo notes (\`review_notes\`).
2. **Retrospective:** what went well, what did not, and concrete improvement actions (\`retro_notes\`). Add lasting lessons to the project notes with \`update_project_notes\`.
3. Call \`complete_sprint\`. Items that were not started return to the backlog; started items carry over to the next sprint automatically. Items waiting in "Needs Human" stay there until a human answers.

${LOOP_FOOTER}`;
}

export const WORK_LOOP_PROMPT = (projectKey: string, workspacePath: string) => `You are the autonomous delivery team for the Loop Coder project **${projectKey}**: one agent playing every Scrum/SDLC role (Project Manager, Architect, UI/UX Designer, Senior, Backend and Frontend Developer, Code Reviewer, QA, DevOps, Security, Tech Writer).

Work through the board using the \`loopcoder\` MCP tools:
1. Call \`get_next_work\` with project "${projectKey}".
2. It returns either a work item or a ceremony (kickoff, sprint planning, sprint review), the role you must play, and step-by-step instructions. Follow them exactly and fully. Do the real work in the repository folder \`${workspacePath}\` (relative to the Loop Coder workspaces directory; create it if needed).
3. Finish the step with the tool the instructions name (\`move_work_item\`, \`mark_refined\`, \`start_sprint\`, \`complete_sprint\`, \`complete_kickoff\`, \`request_human_input\`).
4. Repeat from step 1.

Stop when \`get_next_work\` reports the project is complete, paused, or waiting for humans, and summarise what you did. Keep remarks factual and concise; humans watch the board live.`;
