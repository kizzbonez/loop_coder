# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Release with `npm run release -- patch|minor|major`.

## [Unreleased]

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

### Changed

- The project tab "Claude" is now "Agent", and UI copy is client-neutral.
- The backlog list shows the role that will build each item instead of the refining role.
- Work-item drawers no longer focus the title field when opened.

### Fixed

- Items parked in "Needs Human" during backlog refinement no longer join the next sprint.
- "Agents online" counts agents, not projects with an agent.
- Long agent and role names on cards wrap instead of being cut off.

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
