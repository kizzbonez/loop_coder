# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Release with `npm run release -- patch|minor|major`.

## [Unreleased]

### Fixed

- **The Security Engineer's patrol is easy to spot.** It was a quick 15-second walk that looked like
  any other. Now it is a round of the whole office with a flashlight, a look left and right at
  every stop and more remarks (about 40 seconds). QA's bug hunt also lasts longer.

## [0.10.0] - 2026-10-08

### Added

- **More life in the agent office.** Idle characters now also nap on the sofa (poke twice to wake
  them), gossip at the water cooler, water the plants (which perk up), pet the office cat (it
  purrs and sometimes follows them back to their desk) and talk bugs through with the rubber
  duck. Each role has a hobby of its own: the PM polishes the trophies, the Architect sketches
  on the whiteboard, the Designer paints at the easel, DevOps checks the servers, Security
  patrols, QA hunts bugs with the net and the Technical Writer reads in the library.

## [0.9.1] - 2026-10-08

### Fixed

- **Removing an agent frees its work at once.** Deleting an API agent, revoking an access token
  or disabling a user hands back the work items and ceremonies that agent had claimed, and wakes
  the agents that are waiting. Before, the work stayed locked until the claim timed out.

## [0.9.0] - 2026-10-08

### Added

- **API agents**: on a project's **Agent** tab, administrators add agents that Loop Coder runs
  itself with one of the AI providers, for example Gemini building features while Claude Code
  reviews and tests. Each has a name, a provider and model (or the provider's default), the
  **roles** it plays, a **daily token limit**, a cap on tool rounds per step, and whether it may
  run commands; **Start** and **Stop** run it, and the list shows what it is doing, errors and
  today's tokens.
  - A new **runner** container works the board for them through the MCP server, exactly like a
    connected agent, in their own git worktrees. Claude models use the official Anthropic SDK
    with adaptive thinking, prompt caching and Anthropic's default refusal fallbacks; the other
    providers use their OpenAI-compatible API.
  - The runner never holds provider keys: a **model relay** in the API adds them, enforces the
    agent's model and daily limit, and counts usage. Each agent acts through its own encrypted,
    auto-renewed project token for its roles.
  - Agents' files and commands run as an unprivileged user with a clean environment, limited to
    the project's folders, without internet access.
- `npm run secrets-key` also creates `LOOP_RUNNER_SECRET`.

### Upgrading

- Run `npm run secrets-key` (it keeps your `LOOP_SECRETS_KEY` and adds `LOOP_RUNNER_SECRET`),
  then `npm run up`.

## [0.8.0] - 2026-10-08

### Added

- **AI providers** (Administration → AI providers): store API keys for Anthropic (Claude),
  OpenAI, Google Gemini, Qwen (Alibaba Cloud Model Studio), Kimi (Moonshot AI), DeepSeek,
  OpenRouter or any OpenAI-compatible service, with a default model each.
  - Keys are encrypted at rest (AES-256-GCM) with a new `LOOP_SECRETS_KEY`, kept in `.env`
    and never in the database. `npm run secrets-key` creates it without showing it.
  - After saving, only a key's last four characters are shown; a changed master key marks
    keys as locked. Changes and tests are audited without the key.
  - **Add and test** and **Test** check a key by listing the provider's models (Anthropic
    through the official SDK, the others through their OpenAI-compatible API) and explain any
    failure.
- **Egress gateway**: a small new container that is the server's only way to the internet.
  The API stays on the internal network and reaches only the hosts of enabled AI providers,
  over HTTPS; private and internal addresses are always refused.

### Upgrading

- Run `npm run secrets-key` once, then `npm run up`. Back up `.env` apart from the database.

## [0.7.1] - 2026-10-08

### Changed

- **The Agent tab lists your agents on the project** (every access token that can work on it),
  with the tool each one connected with, when it was last used and the roles it plays, and a
  **Roles** button to change them in place. Before, roles could only be changed on the Account
  page.
- The role picker always shows the roles: ticked and greyed out for *Every role*, to tick with
  *Only these roles*.
- Access tokens report the MCP client that last connected with them.

## [0.7.0] - 2026-10-08

### Added

- **A git worktree per agent.** Agents working side by side no longer share one folder: each
  works in its own git worktree (`<project>.worktrees/<agent>`) and each work item on its own
  branch (`item/<KEY>`). Developers commit on the branch and bring in the latest finished work,
  reviewers and QA check it out without taking it over, and whoever moves the item to Done
  merges it into the base branch in the project folder (a conflicting merge sends the item
  back for rework). `get_next_work` spells out every git step, the item drawer shows the
  branch, and the Files tab shows only finished work. New projects use worktrees; **Settings →
  Git** switches between worktrees and one shared folder and sets the base branch (strictly
  validated, as it appears in the commands agents run).
- **Roles per agent.** Each access token (one per agent) sets the roles its agent plays: every
  role, or only some, chosen when the token is created (Account or the Agent tab) and changeable
  later. `get_next_work` hands an agent only work in its roles and lets it wait otherwise; only
  an agent that plays the Project Manager runs ceremonies, and the sprint review waits until
  agents in other roles have finished the sprint's work.
- Settings sections are named regions for screen readers.

### Upgrading

- Existing projects keep working in one shared folder; switch them under **Settings → Git**.
  Existing tokens keep playing every role.

## [0.6.1] - 2026-10-08

### Changed

- **The board says when a pause or stop is still on its way.** A pause or stop takes effect
  between steps; until the agent finishes its current one, the header says *Pausing* or
  *Stopping* with the item and role it is finishing (for example *Pausing · finishing NT-26 as
  Frontend Developer first*), and the confirmation names the item. It switches to *Agent
  paused* once the agent is waiting.
- `log_progress` tells an agent that the project was paused or stopped, so it can bring its
  step to a safe end sooner.

## [0.6.0] - 2026-10-08

### Added

- **Pause, resume and stop.** The board header now has three controls. **Pause** lets the
  agent finish its current step, then it waits, still connected, and carries on by itself the
  moment someone clicks **Resume** (before, a paused agent ended its session and had to be
  started again). **Stop** lets it finish its current step and end its session; after a stop,
  Resume allows work again and the agent is started from the coding agent as usual.
- **`wait_for_work`** MCP tool: a paused or waiting agent calls it in rounds of up to 50
  seconds; it returns the next work as soon as a human resumes, answers a question or frees up
  an item, and returns `STOPPED` at once on a stop. Abandoned waits never claim work.
- Agents also wait, rather than end, when nothing can move until a human answers in
  **Needs Human**.

### Changed

- `get_next_work` says what to do next with every status (wait, or end the session), and the
  work prompt and the copy-paste loop instructions follow the new rules.
- The office announces stops, and the projects list, sidebar, Agent tab and administration
  show stopped projects.

## [0.5.0] - 2026-10-08

### Changed

- **The Software Engineer is now three developer roles.** The **Backend Developer** builds
  APIs, data and migrations, business logic and integrations; the **Frontend Developer**
  builds screens and components, with accessibility and responsive layouts; the **Senior
  Developer** takes work that spans both, foundation code, complex changes and hard bugs, and
  owns the contract between frontend and backend. The Project Manager assigns each item to
  the right one, and items without a role go to the Senior Developer. Each has its own desk
  and look in the office.
- Upgrading keeps everything working: the existing Software Engineer becomes the Senior
  Developer (the same role, so items, columns, claims and history follow), instructions
  nobody edited are replaced by the new ones, and edited ones are kept. The Project Manager's
  instructions learn about the new roles unless they were customised.

## [0.4.0] - 2026-10-08

### Added

- **A replay for each sprint.** The Flow and Office tabs replay the whole project, the kickoff
  or any single sprint. Each sprint runs from the end of the one before until it completed, so
  its refinement, planning and review are part of it; a sprint still running is marked
  *(ongoing)*.
- **Replays on a real clock.** Moves, remarks and agents appear at the moment they really
  happened, and the clock shows the exact date and time. Speeds go from real time to 1800×,
  **Skip quiet times** jumps over stretches where nothing happened (and says how much it
  skipped), and **Previous / Next moment** jump between the moments something happened.
- **Exact agent positions.** The server now records what every agent shows while it works
  (role, item, ceremony, activity, online or not) in a presence log, and replays show exactly
  that, with the same online rules as the live view. History from before this release shows
  agents inferred from their actions, and the replay bar says so.
- The office replays what the agents really wrote (progress notes, reviews, test reports,
  questions), not only board moves.
- API: `GET /api/projects/:id/replay?segment=all|kickoff|sprint-<n>|latest`.

### Changed

- The replay bar steps between moments in time instead of between events, and its speeds are
  multiples of real time instead of events per second.

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
