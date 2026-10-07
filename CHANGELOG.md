# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Release with `npm run release -- patch|minor|major`.

## [Unreleased]

## [0.3.0] - 2026-10-08

### Changed

- The agent office has one character per role instead of one per agent. Agents play the
  character of the role they work in, so the whole team is in the office and work visibly
  passes from role to role; a second agent in the same role brings in a colleague. Roles
  added later join the team at a free desk. A **Team** panel shows who plays which role.

### Added

- Idle characters play on the console or the arcade machine, take coffee breaks and chat with
  each other; they answer in character when poked. A character with a question waits at the
  help desk, and the whole team meets for kickoff, sprint planning and sprint review.

### Fixed

- The clouds in the office windows stay behind the glass.

## [0.2.0] - 2026-10-08

### Added

- Works with any MCP coding agent, not just Claude Code: the project's **Agent** tab has
  setup instructions for Claude Code, Cursor, VS Code (Copilot) and other MCP clients
  (including the `mcp-remote` stdio bridge), for Windows and macOS/Linux, plus copy-paste loop
  instructions for clients without MCP prompt support.
- The board names the agent that is working (e.g. "Cursor is working as Software Engineer")
  from the MCP client's `clientInfo`; activity, remarks, claims, presence and agent sessions
  all carry the agent name (database migration `0001_agent_names`).
- Illustrated user guide (`docs/USER_GUIDE.md`) with screenshots generated from a demo
  project by `npm run docs:screenshots`.
- The guide is built into the app: **User guide** in the sidebar and the user menu. It opens
  on an overview with full-text search, "Start here" cards and every topic, and each section
  has its own page (`/guide/<section>`) with a side navigation, previous/next links, a reading
  progress bar, framed click-to-enlarge screenshots, Note/Tip/Warning callouts, copyable code
  and step-by-step lists. Press `/` to search. The Agent tab links to the connection steps, and
  older `/guide#section` links still work.
- `FRAME_ANCESTORS` setting: let your own sites show Loop Coder in an iframe (default: framing
  blocked). Validated at container start; see [DEPLOY.md](docs/DEPLOY.md).
- **Flow** tab: the project's SDLC as a live, animated graph (Scrum loop, delivery pipeline,
  Needs Human). Agents glide between stages, work items travel along the paths, rework and
  escalations light up, and a live feed lists every move. **Replay** plays back the history;
  **Replay journey** on a work item follows it through every stage with the time spent in each.
- **Office** tab: a pixel-art office where every agent is a character dressed for its role
  (roles added later get a generated outfit in their colour). Agents walk to their stations,
  talk about their work in speech bubbles and a dialogue box, and react when poked; objects
  react too. 8-bit sound effects, three original chiptune tracks and a game menu (music,
  track, volumes, name tags, text speed). Sound and music are synthesised in the browser.
- The API records the stages of every move and every Scrum ceremony start, tracks which
  ceremony each agent is running (migration `0002_agent_ceremony`), lists every online agent
  of a project, and serves the flow history with `GET /api/projects/:id/activity?kind=flow`.
- A page that fails shows a recoverable message instead of a blank screen.

### Changed

- The project tab "Claude" is now "Agent", and UI copy is client-neutral.
- The backlog list shows the role that will build each item instead of the refining role.
- Work-item drawers no longer focus the title field when opened.
- The user guide has two new sections (The Flow view, The agent office); later sections are
  renumbered, and links with the old numbers still open the right section.

### Fixed

- Items parked in "Needs Human" during backlog refinement no longer join the next sprint.
- "Agents online" counts agents, not projects with an agent.
- Long agent and role names on cards wrap instead of being cut off.
- Completing the kickoff now updates open boards without a reload.
- Project update events no longer carry the access level of whoever made the change, so a
  viewer never sees editing controls they cannot use.
- Adding an item to the running sprint (or removing it) from its details is recorded as a
  move, so the history and replays include it.

## [0.1.0] - 2026-10-03

### Added

- Workspaces → projects → one Agile/Scrum Kanban board per project (Backlog, To Do,
  In Progress, Code Review, QA / Testing, Needs Human, Done) with WIP limits, epics,
  stories, tasks, bugs, spikes, story points, dependencies, Definition of Ready/Done.
- Sprints: planning, start, completion with review and retrospective notes, carry-over
  of unfinished work, velocity and a burndown chart.
- MCP server (Streamable HTTP, `/mcp`) with 17 tools and a `work` prompt so Claude Code
  works the board as a single agent playing nine SDLC roles (Project Manager, Architect,
  UI/UX Designer, Software Engineer, Code Reviewer, QA, DevOps, Security, Tech Writer).
- Workflow engine: kickoff → sprint work (pull from the right) → refinement → sprint
  review → planning, with claims, WIP-aware pulling, rework limits that escalate to a
  human, pause/resume and an admin kill switch.
- Realtime board over Server-Sent Events, live agent presence and activity feed.
- First-run onboarding wizard protected by a one-time setup code from the server logs.
- Administration: users, workspaces, projects, agent roles, settings, access tokens,
  agent sessions, audit log, system info and online database backup.
- Security: scrypt password hashing, hashed session and access tokens, SameSite=Strict
  cookies, CSRF header + origin checks, rate limiting, account lockout, strict CSP,
  read-only non-root containers.
- SQLite storage created automatically on first start; Docker Compose deployment.
- Cloudflare Tunnel publishing: dedicated `loop-coder-edge` network for a tunnel connector,
  internal API network, real visitor IPs from `CF-Connecting-IP`, multi-origin `APP_ORIGIN`,
  HSTS, and an optional built-in `cloudflared` service (`--profile tunnel`).
- Route-level code splitting (initial bundle ≈ 90 KB gzipped).
- Test suites: API unit/integration (Vitest + Supertest), web unit/component (Vitest +
  Testing Library) and browser end-to-end tests (Playwright) against the Docker stack.
