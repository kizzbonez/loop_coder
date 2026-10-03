# MCP server reference

- **Endpoint:** `POST http://<host>:8080/mcp`. Streamable HTTP, stateless (JSON responses).
  `GET`/`DELETE` return 405.
- **Auth:** `Authorization: Bearer lc_pat_…`, a personal access token created under
  Account → Access tokens or on a project's Claude tab. The agent acts with the token
  owner's permissions (editor or higher is needed to pull work), narrowed to the token's
  workspace or project scope.
- **Server name:** `loopcoder`. Tools appear in Claude Code as `mcp__loopcoder__<tool>`.
- **Agent name:** the board labels every agent action with the client's name from its
  MCP `initialize` (`clientInfo.name`), e.g. "Claude Code", "Cursor", "VS Code", or "Agent"
  when unknown. Several agents can work the same project; claims keep them apart.

## Compatible clients

Any MCP client that can call tools in a loop and edit files works. The project's
**Agent** tab generates ready-to-paste snippets with your token for each of these.

| Client | How to connect | How to start |
|---|---|---|
| **Claude Code** (CLI, desktop, IDE) | `claude mcp add --transport http loopcoder <url>/mcp --header "Authorization: Bearer …"` run inside the project folder (or `--scope user`), or a `.mcp.json` with `${LOOPCODER_TOKEN}` | `/mcp__loopcoder__work KEY`, or continuously with `/loop /mcp__loopcoder__work KEY` |
| **Cursor** | `.cursor/mcp.json`: `{"mcpServers":{"loopcoder":{"url":"<url>/mcp","headers":{"Authorization":"Bearer …"}}}}` | Paste the loop instructions into Agent chat |
| **VS Code** (Copilot agent mode) | `.vscode/mcp.json`: `{"servers":{"loopcoder":{"type":"http","url":"<url>/mcp","headers":{"Authorization":"Bearer …"}}}}` | Paste the loop instructions into Copilot Chat (Agent mode) |
| **Other HTTP clients** (Windsurf, Cline, Codex, Gemini CLI…) | Streamable HTTP, URL `<url>/mcp`, header `Authorization: Bearer …` | Use the `work` prompt if supported, otherwise the loop instructions |
| **stdio-only clients** | Bridge: `npx -y mcp-remote <url>/mcp --header "Authorization:${AUTH_HEADER}"` with `AUTH_HEADER="Bearer …"` in `env` | As above |

The server authenticates with bearer tokens, not OAuth. Clients that only offer an OAuth
login for remote servers should use the `mcp-remote` bridge.

Files that contain a token (`.cursor/mcp.json`, `.vscode/mcp.json`) belong in the project's
`.gitignore`.

## Prompt

| Prompt | Arguments | Use |
|---|---|---|
| `work` | `project` (key) | Starts the delivery loop. In Claude Code: `/mcp__loopcoder__work SHOP`, or continuously with `/loop /mcp__loopcoder__work SHOP`. |

## Tools

`project` is a project key (e.g. `SHOP`) or id. You can omit it when the token is scoped to
one project. `item` is a work item key (`SHOP-12`) or id.

| Tool | Arguments | What it does |
|---|---|---|
| `list_projects` | none | Projects you can access, with progress, agent state and repository folder. |
| `get_project_context` | `project` | Goal, Definition of Ready and Done, project notes, board summary, active sprint, available roles. |
| `get_next_work` | `project` | Claims the next work item or ceremony and returns the role to play plus step-by-step instructions. Returns `STATUS: PAUSED / DISABLED / WAITING / COMPLETE` when there is nothing to do. |
| `get_work_item` | `item` | Full item with acceptance criteria and remark thread. |
| `list_work_items` | `project`, `column?`, `type?`, `active_sprint_only?`, `limit?` | Compact list of items. |
| `create_work_items` | `project`, `items[]` | Batch create. Each item may carry a `ref` used by other items' `parent` and `depends_on`. Fields: `type, title, description, acceptance_criteria, priority, story_points, parent, depends_on, assigned_role, labels, refined`. |
| `update_work_item` | `item`, fields… | Edit fields. `depends_on` replaces the list; `parent: null` detaches. |
| `add_remark` | `item`, `body`, `kind?` | Kinds: `work_log`, `design`, `review`, `test_report`, `comment`, `question`. |
| `move_work_item` | `item`, `to`, `remark`, `kind?` | Hands the item to another stage (`review`, `testing`, `done`, `in_progress`, …) with a required remark. Sending work back from review or testing counts as rework. |
| `mark_refined` | `item`, `summary` | Finishes refinement (requires story points and acceptance criteria, except for epics). |
| `request_human_input` | `item`, `question` | Moves the item to **Needs Human** with the question. |
| `release_work_item` | `item`, `note?` | Gives up a claim without moving the item. |
| `log_progress` | `project`, `message`, `item?` | Live progress note on the board; also extends the claim. |
| `complete_kickoff` | `project`, `summary` | Ends the kickoff (requires at least one work item). |
| `start_sprint` | `project`, `goal`, `items[]`, `name?` | Sprint planning outcome: commits refined backlog items and starts the sprint. |
| `complete_sprint` | `project`, `review_notes`, `retro_notes` | Sprint review and retrospective outcome. Unstarted items return to the backlog; started items carry over. |
| `update_project_notes` | `project`, `text`, `mode?` | Shared project memory (`append` adds a dated entry, `replace` rewrites it; 100k character limit). |

Errors come back as tool results with `isError: true` and a readable message, for example
validation failures, unknown roles (with the list of valid ones), or items claimed by
another session.
