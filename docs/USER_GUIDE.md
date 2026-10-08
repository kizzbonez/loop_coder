# Loop Coder user guide

Loop Coder is a Kanban board for agile software projects that an **AI coding agent works
through on its own**. You describe what you want built. The agent (Claude Code, Cursor,
VS Code with GitHub Copilot, or any other tool that speaks MCP) plans the backlog, then
designs, builds, reviews and tests every item, moving the cards as it goes. You watch the
board update live, answer its questions, and can pause it at any time.

This guide is for everyone who uses Loop Coder: the **administrator** who installs and
manages it, and the **team members** who create projects and work with the agent. You can
open it at any time from **User guide** in the app's sidebar.

![The board while two agents work on it](images/guide/12-board.png)

## Contents

1. [Key ideas](#1-key-ideas)
2. [First-time setup (administrator)](#2-first-time-setup-administrator)
3. [Signing in](#3-signing-in)
4. [Workspaces and members](#4-workspaces-and-members)
5. [Creating a project](#5-creating-a-project)
6. [Connecting your AI agent](#6-connecting-your-ai-agent)
7. [What the agent does](#7-what-the-agent-does)
8. [The board](#8-the-board)
9. [The Flow view](#9-the-flow-view)
10. [The agent office](#10-the-agent-office)
11. [Work item details and answering questions](#11-work-item-details-and-answering-questions)
12. [Backlog and refinement](#12-backlog-and-refinement)
13. [Sprints](#13-sprints)
14. [Activity and files](#14-activity-and-files)
15. [Project settings](#15-project-settings)
16. [Your account and access tokens](#16-your-account-and-access-tokens)
17. [Administration](#17-administration)
18. [Dark mode and mobile](#18-dark-mode-and-mobile)
19. [Troubleshooting and FAQ](#19-troubleshooting-and-faq)

---

## 1. Key ideas

Loop Coder organises work the way an Agile team does. These are the words you will see
throughout the app.

| Term | Meaning |
|---|---|
| **Workspace** | A team space that contains projects and members. People are invited to a workspace and get access to all its projects. You can belong to several workspaces. |
| **Project** | One product or codebase with its own board, backlog, sprints and code folder. Every project has a short **key** such as `CANDLE`, so items are numbered `CANDLE-1`, `CANDLE-2`, and so on. |
| **Work item** | A card on the board: an **epic** (a big feature that groups others), **story**, **task**, **bug** or **spike** (a time-boxed investigation). |
| **Agent** | The AI coding tool connected to the project. One agent plays **every role** in the team. |
| **Role** | How the agent behaves in a given stage: Project Manager, Software Architect, UI/UX Designer, Senior Developer, Backend Developer, Frontend Developer, Code Reviewer, QA Engineer, DevOps, Security or Technical Writer. |
| **Sprint** | A batch of work the team commits to, with a goal. It ends with a review and a retrospective. |
| **Definition of Ready / Done** | The checklists an item must meet before it is planned (Ready) and before it is finished (Done). |
| **Needs Human** | The column where the agent puts items it cannot finish without your decision. |

---

## 2. First-time setup (administrator)

The first time Loop Coder starts, every page leads to the **setup wizard**. It creates the
administrator account and the first workspace.

![Setup wizard: welcome](images/guide/01-setup-welcome.png)

**Step 1: Verify that you own the server.** The wizard asks for a one-time **setup code**,
so that a stranger who reaches the page cannot take over your installation. The code is
in the server log:

```powershell
docker compose logs api | Select-String "setup code"        # Windows PowerShell
docker compose logs api | grep -i "setup code"              # macOS / Linux
```

If `SETUP_CODE` is set in the `.env` file, that value is the code. Codes are not case-sensitive.

![Setup wizard: setup code](images/guide/02-setup-code.png)

**Step 2: Create the administrator.** Use a long password: at least 12 characters by
default, and a passphrase works well. The administrator manages users, roles, settings and security.

![Setup wizard: administrator account](images/guide/03-setup-admin.png)

**Step 3: Name your workspace.** You can also rename the application and decide whether
people may register themselves. Leave registration off unless the server is private.

![Setup wizard: workspace](images/guide/04-setup-workspace.png)

That's it. The wizard turns itself off for good once the administrator exists.

![Setup complete](images/guide/05-setup-done.png)

> [!IMPORTANT]
> **Publishing on the internet?** Finish the wizard *before* you make the site public, for
> example through a Cloudflare Tunnel. See [DEPLOY.md](DEPLOY.md).

---

## 3. Signing in

Go to your Loop Coder address (for example `http://localhost:8080`) and sign in with
your email and password.

![Sign-in page](images/guide/34-login.png)

- After several wrong passwords in a row (5 by default), the account is **locked for 15
  minutes**. An administrator can unlock it sooner.
- Sessions last 72 hours and are extended while you use the app. Changing your password
  signs you out everywhere else.
- Use the menu with your name at the bottom left to open **Account** or **Sign out**.
  Next to it, switch between **light**, **dark** and **system** theme.

---

## 4. Workspaces and members

The sidebar shows your current workspace at the top. Click it to switch workspaces or
create a new one. Below it you find the workspace's **Projects** and **Members** and the
list of its projects.

![Workspace with its projects](images/guide/23-workspace-projects.png)

Each project card shows its progress, story points, and whether the agent is paused,
waiting for the kickoff, or needs you.

### Members and permissions

Open **Members** to see who has access. Workspace owners can invite people (they need an
account first, which an administrator can create), change roles, remove members, or
transfer ownership.

![Workspace members](images/guide/24-workspace-members.png)

| Workspace role | Can do |
|---|---|
| **Owner** | Everything, including project and workspace settings, members and deleting. |
| **Editor** | Create projects and work items, plan sprints, comment and answer the agent, pause and resume the agent, create access tokens. |
| **Viewer** | Read boards, backlog, sprints, activity and files. Cannot change anything. |

Platform **administrators** can open every workspace, whether or not they are a member.

---

## 5. Creating a project

A project is one product or codebase. It gets its own board, backlog, sprints and code folder,
all set up for you. Click **New project** on the workspace page.

![New project dialog](images/guide/07-new-project.png)

- **Project name** and **Key**: the key (2–8 letters and digits) prefixes every item number
  and must be unique on the server. It is suggested from the name.
- **Goal and requirements**: this is what the agent reads during the kickoff. The more
  context you give, the better the backlog. Describe who the users are, the main
  features, constraints, and any preferred technology.

After creating the project you land on its **Agent** tab to connect your AI agent.

> [!TIP]
> Write the goal like a short brief for a new team member: who it is for, what they must be
> able to do, what is out of scope, and any technology you want or must avoid.

---

## 6. Connecting your AI agent

Open the project's **Agent** tab. Choose your tool (**Claude Code**, **Cursor**, **VS Code**
or **Other MCP client**) and your operating system. The page then shows exactly what to do.

![Agent tab before connecting](images/guide/08-agent-tab.png)

### Step 1: Create a project token

Choose the **roles this agent plays**: every role, or **Only these roles** and tick the ones
it should do (the list shows every role either way). Then click **Create project token**. The token lets the agent act on **this project only**, with your permissions. It is
shown **once**, so copy it now. All snippets on the page fill in the token automatically.

### Step 2: Create the project folder

The agent writes the project's code into `workspaces/<workspace>/<project>` inside the
Loop Coder folder, and the **Files** tab shows it live. Run the commands shown (they include
`git init`, so the project gets its own repository).

### Step 3: Connect the agent

![Instructions for Claude Code](images/guide/09-agent-tab-claude-code.png)

- **Claude Code** (command line, desktop app or IDE extension): run the `claude mcp add …`
  command **inside the project folder**, because Claude Code registers servers per folder.
  Add `--scope user` to make it available everywhere. Then start Claude Code there and type
  `/mcp` to check that `loopcoder` is connected.
- **Cursor**: create `.cursor/mcp.json` in the project folder with the snippet shown, open the
  folder in Cursor, and enable the server under **Settings → MCP**.
- **VS Code**: create `.vscode/mcp.json`, open the folder, start the server from the MCP list,
  and use Copilot Chat in **Agent** mode.
- **Other MCP clients**: use the URL and header shown. Tools that only run local servers use
  the `mcp-remote` bridge snippet.

![Instructions for Cursor](images/guide/10-agent-tab-cursor.png)

![Instructions for other MCP clients](images/guide/11-agent-tab-other.png)

> [!WARNING]
> **Keep tokens private.** Files that contain the token (`.cursor/mcp.json`,
> `.vscode/mcp.json`) must be added to the project's `.gitignore`.

### Step 4: Start the loop

- **Claude Code**: run `/mcp__loopcoder__work CANDLE`, using your project key. To keep it
  running continuously, including picking up again after you answer its questions, use
  `/loop /mcp__loopcoder__work CANDLE`.
- **Other agents**: paste the instructions shown into the agent chat in agent mode. When the
  agent stops because it is waiting for you, answer on the board and send the same instructions again.

The agent now works on its own. You can follow everything on the board.

### Several agents at once

Several agents can work on the same project side by side, for example one Claude Code session
building features while another reviews and tests. Set it up like this:

1. **One token per agent.** Each token is one agent: it is labelled on the board and in the
   office, and it gets its own git worktree (see below). Two sessions sharing a token count as
   the same agent and could pick the same item.
2. **Roles per agent.** When you create a token, choose **Only these roles** and tick the roles
   that agent plays, for example *Senior, Backend and Frontend Developer* for a builder and
   *Code Reviewer* and *QA Engineer* for a checker. `get_next_work` then hands that agent only
   work for its roles; with nothing to do it waits connected. Only an agent that plays the
   **Project Manager** runs the kickoff, backlog refinement, sprint planning and sprint reviews,
   so make sure one of them does. The project's **Agent** tab lists **your agents on this
   project** with the roles each plays; click **Roles** next to one to change them (also under
   **Account → Access tokens**). The change applies from the agent's next step.
   Administrators can also add **API agents** there, which Loop Coder runs itself with an AI
   provider's key (see [API agents](#api-agents-a-providers-model-plays-chosen-roles)).
3. **A git worktree per agent.** New projects give every agent its own working copy, so agents
   never edit the same files:
   - each agent works in `workspaces/<workspace>/<project>.worktrees/<agent>`, a git worktree of
     the project folder;
   - each work item has its own branch, `item/<KEY>` (for example `item/CANDLE-12`), shown in
     the item's details;
   - developers commit on the item's branch and bring in the latest finished work before
     handing it on; reviewers and QA check the branch out in their own worktree without taking
     it over;
   - whoever moves the item to **Done** merges its branch into the base branch in the project
     folder (and sends it back for rework if the merge conflicts).

   The project folder therefore holds only finished work, which is what the **Files** tab shows.
   Change this under **Settings → Git**: *A git worktree per agent* (the default for new
   projects) or *One shared project folder* (how projects created before this worked), and the
   **base branch** (`main` by default).

---

## 7. What the agent does

The agent always asks Loop Coder what to do next. Loop Coder answers like a Scrum Master
would, in this order:

1. **Kickoff** (once, as Project Manager): it reads your goal, writes the vision, tech stack
   and conventions into the project notes, and creates the first backlog of epics and stories.
2. **Sprint work** (pull from the right): it finishes items closest to **Done** before
   starting new ones, and respects dependencies and WIP limits. The role changes with the stage:
   - **In Progress**: the item's assigned role does the real work in the code folder. For
     code, the Project Manager picks the **Backend Developer** (APIs, data, business logic,
     integrations), the **Frontend Developer** (screens, components, accessibility) or the
     **Senior Developer** (work that spans both, foundation code, complex changes and hard
     bugs); other items go to the Architect, UI/UX Designer, DevOps, Security or Technical
     Writer. An item without a role goes to the Senior Developer.
   - **Code Review**: the Code Reviewer approves it or sends it back with a numbered list of changes.
   - **QA / Testing**: the QA Engineer checks every acceptance criterion and runs the tests,
     then sends the item to Done with a test report, or back for a fix.
3. **Backlog refinement** (as Project Manager): it turns rough ideas into ready stories with
   acceptance criteria, estimates and dependencies, and splits large items.
4. **Sprint review and retrospective**: when the sprint's work is finished.
5. **Sprint planning**: it picks the highest-value ready items up to the sprint capacity and
   sets a sprint goal.

If something only a person can decide comes up, the agent **asks you** by moving the item
to **Needs Human**. If an item is sent back for rework too often (more than 4 times by default), it is
escalated to you automatically.

---

## 8. The board

Every project has one board. Work items move from left to right through the columns below,
and the board updates live while the agent works.

![The board](images/guide/12-board.png)

| Column | Who works it | What happens there |
|---|---|---|
| **Backlog** | Project Manager | Ideas and stories wait here and are refined until they meet the Definition of Ready. |
| **To Do** | the item's role | The sprint's committed items. When the agent picks one up it moves to In Progress. |
| **In Progress** | the item's role | Design, code, infrastructure or documentation work. |
| **Code Review** | Code Reviewer | Approve → QA, or request changes → back to In Progress. |
| **QA / Testing** | QA Engineer | Verify → Done, or report a failure → back to In Progress. |
| **Needs Human** | you | Questions from the agent and escalated items. |
| **Done** | none | Meets the Definition of Done. Epics finish automatically when all their items are done. |

### Live status and pausing

The header shows which agent is working, in which role, on which item, and what it is
doing right now. **Live** next to the project name means updates arrive in real time.

![Agent status with the pause and stop buttons](images/guide/14-agent-status.png)

Three buttons control the agent. Editors and owners can use them.

| Button | What the agent does |
|---|---|
| **Pause agent** | Finishes its current step, then waits. Until then the header says, for example, *Pausing · finishing NT-26 as Frontend Developer first*. It stays connected (checking in about once a minute) and carries on by itself the moment you click **Resume agent**. |
| **Resume agent** | Carries on at once if it was waiting. After a stop, the agent may work again, but you start it again from your coding agent (the Agent tab shows how). |
| **Stop agent** | Finishes its current step (the header says *Stopping* until then) and ends its session. Use it when you are done for the day or want to change something before it continues. |

The agent also waits, rather than ending, when nothing can move until you answer a question
in **Needs Human**: answer it and the agent picks the work up again.

The line under the title shows the active sprint, its goal and progress, how many items are
done, and a red **waiting for you** badge when the agent needs an answer.

### Reading a card

![A card the agent is working on](images/guide/13-card-working.png)

- **Top row:** type icon (epic, story, task, bug, spike), the item key, a **draft** label if
  it is not refined yet, priority bars (more bars = higher priority), and the story points.
- **Title**, then the **epic** it belongs to and any **labels**.
- **Agent bar:** a glowing border and "*Claude Code is working as Senior Developer*" show
  which agent is working on it and in which role. Several agents can work on one project at
  the same time.
- **Bottom row:** the role for the current stage, a lock with a number when it waits on
  unfinished dependencies, a red ↺ number for rework cycles, the number of remarks, and a robot
  icon when the agent created it.

### Column headers

![Column header](images/guide/15-column-header.png)

Each column shows its item count and, if set, the **WIP limit** (for example `3/4`). The
count turns red when the limit is exceeded. Below it is the role that works the column.

### Working on the board yourself

- **Drag and drop** cards between columns and within a column. With the keyboard, focus a
  card, press **Space** to pick it up, use the arrow keys, and press **Space** again to drop it.
- Click **+** on a column to quick-add an item there.
- Use **Filter items**, the **type** filter and **Current sprint only** to focus.
- Click a card, or press **Enter** on it, to open its details.

---

## 9. The Flow view

The **Flow** tab shows the project's SDLC as a live graph: the Scrum loop (kickoff, sprint
planning and sprint review) at the top, the delivery pipeline from Backlog to Done in the
middle, and Needs Human underneath.

![The Flow view while two agents work](images/guide/35-flow.png)

- **Stages** show how many items they hold, the role that works them and their WIP limit.
  Click a stage to list its items, and click an item to open it.
- **Agents** are the round markers. They glide to the stage they are working in, labelled with
  their name, role and item. A speech bubble shows what an agent just reported.
- **Work items travel** along the paths as cards move, and the path lights up. Dashed red arcs
  are **rework** (changes requested, failed QA), labelled with how often they happened. Amber
  paths lead to and from **Needs Human**.
- The **Live feed** lists every move the moment it happens.

### Replay and item journeys

Switch to **Replay** to play back what really happened, on a real clock:

- **What to replay:** the **Whole project**, the **Kickoff**, or one **sprint** at a time
  (each sprint runs from the end of the one before until it completed, so its refinement,
  planning and review are included). A sprint still running is marked *(ongoing)*.
- The clock shows the exact date and time of the moment on screen, and how far into the part
  you are. Events, remarks and agents appear at the time they really happened, so a busy
  minute is busy and a quiet hour is quiet.
- **Play** runs the clock faster than real time: from **1×** (real time) to **1800×** (30
  minutes per second). **Skip quiet times** jumps over stretches where nothing happened for
  more than two minutes and says how much it skipped.
- **Previous / Next moment** jump to the moments something happened: a move, a remark, an
  agent changing role or item, or going offline. You can also drag the slider.
- Agents are shown exactly where they were: Loop Coder records what every agent shows (role,
  item, ceremony, activity) while it works. History from before that recording started (version
  0.4.0) shows agents inferred from their actions instead, and the replay bar says so.

To follow one item, open it and click **Replay journey** (the route icon in the item's header).
The **Journey** panel lists every stage the item went through, who moved it in which role and
how long it stayed in each stage, and the graph highlights the paths it took.

![Replaying an item's journey](images/guide/36-flow-journey.png)

> [!TIP]
> Rework arcs with high counts show where work bounces back. If many items return from review,
> refine them better or tighten the Definition of Ready.

---

## 10. The agent office

The **Office** tab shows the same live data as a small pixel-art game. The office has an area
for every stage: the backlog library, the meeting room for the Scrum ceremonies, the sprint
board, the workshop, the ops and security corner, the review room, the QA lab, the ship dock,
the help desk (Needs Human) and a lounge for idle agents.

![The agent office](images/guide/37-office.png)

- The office has **one character per role**, each with its own desk and look: the Project
  Manager and the Technical Writer in the backlog library, the engineers, the architect (at the
  whiteboard) and the designer (at the easel) in the workshop, DevOps and Security in the ops
  corner, the Code Reviewer in the review room and QA in the lab. Roles your administrator adds
  later join the team at a free desk, dressed in the role's colour.
- When an agent works in a role, it **plays that character**: the character walks to where the
  work is, types at its desk, and gets a second name tag with the agent's name. When the agent
  moves on to another role, the next character takes over and the previous one goes back to its
  desk. If two agents play the same role at once, a colleague walks in to help.
- Characters **talk** in speech bubbles as they work: progress updates, work logs, review notes,
  test reports and questions. The latest line also types out in the dialogue box under the map,
  and **Office chatter** keeps every line. A character with a question for you waits at the help
  desk. When you answer, you appear behind the desk.
- Characters with nothing to do have a life of their own: they play on the console or the
  arcade machine, fetch a coffee, or meet colleagues for a chat (you can read the conversation in
  their speech bubbles). During kickoff, sprint planning and sprint review the whole team meets
  in the meeting room.
- The **Team** panel lists every role, which agent is playing it and on which item.
- The sprint board on the wall, the trophy shelf at the ship dock and the blinking help sign
  show the real numbers from the board.
- **Click anyone or anything.** Characters tell you what they are doing (from "No bugs to hunt
  right now" to "Shh, boss level!") and get annoyed if you keep poking them. The rubber duck, the coffee machine, the plant, the printer, the cat, the
  help desk bell, the release gong and the server rack all react. With the keyboard, focus the
  map, choose with the arrow keys and press Enter.

### Sound, music and the game menu

Click **Menu** (or press M while the map has focus) to open the game menu.

![The game menu](images/guide/38-office-menu.png)

| Setting | What it does |
|---|---|
| **Music** | Original chiptune background music. Off until you turn it on. |
| **Track** | *Morning Stand-up*, *Deep Focus* or *Release Day*. |
| **Music volume**, **Effects volume** | Ten steps each. |
| **Sound effects** | Footsteps, text beeps, the duck, the gong and the other effects. |
| **Name tags** | Show or hide the names under the characters. |
| **Text speed** | How fast speech types out. |

Choose and change settings with the arrow keys, toggle with Enter and close with Esc. Your
browser remembers them. **Sound on / Mute** next to the menu silences everything at once.
Browsers only allow sound after you click or press a key on the page, so the office starts
silent.

> [!NOTE]
> The office has a **Replay** mode too, with the same clock and the same choice of the whole
> project, the kickoff or a sprint: the characters walk to where the agents really were and say
> what was really said (moves, progress notes, reviews, test reports and questions), each at
> the moment it happened.

---

## 11. Work item details and answering questions

Click any card to see everything about the item: its details, its history, and the place where
you answer the agent's questions.

![Work item details with the remark history](images/guide/16-task-drawer.png)

The details panel opens on the right:

- **Title, description and acceptance criteria** can be edited (click the pencil). Markdown is
  supported: lists, tables, code.
- **Properties** on the right: stage, type, priority, story points, **agent role** (who
  implements it), **human owner** (when set, the agent leaves the item alone), sprint, epic,
  labels and the **Ready (refined)** switch.
- **Depends on**: items that must be done first. The agent will not start an item while its
  dependencies are open.
- **Remarks and history**: everything the agent and your team wrote, labelled with the
  author, the role and the kind of remark (work log, design, code review, test report,
  question, answer, comment).

### Answering the agent

When the agent needs a decision, the item appears in **Needs Human** with its question.

![Answering a question from the agent](images/guide/17-needs-human.png)

1. Open the item and read the question.
2. Type your answer in the box below the remarks.
3. Click **Answer & resume**. The item goes back to the stage it came from, the rework counter
   resets, and the agent continues with your answer the next time it picks up work.

Use **Comment** instead for remarks that should not send the item back yet.

> [!NOTE]
> The agent picks up your answer the next time it asks for work. With Claude Code's `/loop`
> that happens automatically; with other agents, send the loop instructions again.

---

## 12. Backlog and refinement

The **Backlog** tab lists everything that is not done yet.

![Backlog](images/guide/18-backlog.png)

- **Add to backlog** at the top: type an idea and choose its type. It starts as a *Draft*,
  and the agent's Project Manager refines it into a ready story.
- **Waiting for your answer** lists items in Needs Human.
- **Epics** show their progress. Click an epic to filter the lists to its items, or
  double-click it to open it.
- The **active sprint** and the **product backlog** are listed separately with readiness,
  priority, assigned role and story points.
- **Planning a sprint yourself:** tick ready items, choose a sprint, and click **Add to
  sprint**. Usually the agent does this during sprint planning.

---

## 13. Sprints

The agent runs sprints on its own: it plans them, works through them and closes them with a
review. The **Sprints** tab shows their progress, and you can plan, start and complete sprints
yourself too.

![Sprints with the burndown chart](images/guide/19-sprints.png)

- The **active sprint** shows its goal, progress in items and points, and a **burndown chart**
  of remaining story points (purple) against an ideal line (grey). Hover over or focus the
  chart to read exact values.
- **Plan a sprint** creates a planned sprint. Start it when no other sprint is active.
- **Complete sprint** asks for review and retrospective notes. Items that were never started
  return to the backlog, and items in progress carry over to the next sprint automatically.
- **Completed** sprints keep their review and retrospective notes. The header shows the
  sprint capacity and the average velocity of recent sprints.

---

## 14. Activity and files

**Activity** is the project's live timeline: who did what and when. Filter it to the agents
or to people.

![Activity timeline](images/guide/20-activity.png)

**Files** shows the code in the project folder, read-only, as the agent writes it. Click
folders to expand them and files to view them.

![File browser](images/guide/21-files.png)

---

## 15. Project settings

Shape how the team works: the goal, the Definitions of Ready and Done, shared notes and the
board columns. Project owners find these settings under **Settings**.

![Project settings](images/guide/22-project-settings.png)

- **General:** name, goal and requirements, and **sprint capacity** in story points.
- **Agile agreements:** the **Definition of Ready** and **Definition of Done**. Every role
  checks them.
- **Project notes:** the team's shared memory. The agent records decisions, conventions and
  lessons here and reads them at every step. You can edit them too.
- **Git:** whether each agent works in its own git worktree with a branch per item, or everyone
  in the one project folder, and the **base branch** finished items are merged into. Branch
  names may contain letters, digits, `.`, `_`, `-` and `/` (see
  [Several agents at once](#several-agents-at-once)).
- **Board columns:** rename columns, change colours, set **WIP limits**, choose which **agent
  role** works each column, and whether the role comes from the column or from each item's
  assigned role.
- **Danger zone:** delete the project. You must type the project key to confirm. The code
  folder on disk is not touched.

---

## 16. Your account and access tokens

Manage your profile, password and signed-in browsers, and the tokens your agents use to
connect. Open **Account & tokens** in the sidebar.

![Account page](images/guide/25-account.png)

- **Profile:** your display name.
- **Access tokens:** create, see and revoke the tokens your agents use. Give each token a
  clear name, limit it to **one project or workspace** whenever you can, and choose an
  expiry. The token value is shown only once. Revoking it stops every agent using it immediately.
  Each token also sets the **roles** its agent plays (every role, or only some); click **Roles**
  next to a token to change them.
- **Password:** change it. All your other sessions are signed out.
- **Active sessions:** every browser signed in to your account. Sign out the ones you don't recognise.

---

## 17. Administration

Everything about the server in one place: users, workspaces, agent roles, security settings,
the audit log and backups. Administrators see **Administration** in the sidebar.

![Administration overview](images/guide/26-admin-overview.png)

| Page | What you can do |
|---|---|
| **Overview** | Users, workspaces, finished work, agents online, sessions and failed sign-ins in the last 24 hours, recent agent activity and security events. |
| **Users** | Create users, make or remove administrators, disable or enable accounts, unlock locked accounts, reset passwords, sign a user out everywhere, delete users (their workspaces are transferred to you). |
| **Workspaces** | Every workspace and project on the server; open or delete them. |
| **Agent roles** | Edit the instructions of the eleven built-in roles, or add your own roles (for example a Data Engineer). |
| **Agent sessions** | Every agent connection: which tool, for which project, on whose behalf, how many tool calls and finished items. |
| **AI providers** | API keys for AI models: Anthropic (Claude), OpenAI, Gemini, Qwen, Kimi, DeepSeek, OpenRouter or any OpenAI-compatible service. Keys are stored encrypted; **Test** checks a key. See [AI providers and API keys](#ai-providers-and-api-keys). |
| **Tokens** | All access tokens of all users; revoke any of them. |
| **Settings** | Registration, password and lockout rules, session and token lifetimes, the agent **kill switch**, rework limit, claim timeout. |
| **Audit log** | A permanent record of sign-ins, failed attempts, lockouts, admin actions, token and settings changes. |
| **System** | Server version, commit, uptime, database size and schema version, and **Download backup**. |

![Users](images/guide/27-admin-users.png)

![Agent roles](images/guide/28-admin-roles.png)

![Settings](images/guide/29-admin-settings.png)

![Audit log](images/guide/30-admin-audit.png)

![System and backup](images/guide/31-admin-system.png)

> [!CAUTION]
> **Backups** contain all data, including password hashes. Store them somewhere secure.

### AI providers and API keys

Agents that use an **API key** instead of a Claude Code (or other) subscription need a
provider. Add one under **Administration → AI providers**:

1. **Turn on secret storage once.** On the server, in the Loop Coder folder, run
   `npm run secrets-key`. It writes a random `LOOP_SECRETS_KEY` into `.env` without showing
   it. Then restart with `npm run up`. Until then the page says secret storage is not set up.
2. **Add provider:** choose the provider, give it a name, paste the **API key** and choose a
   **default model** (Anthropic starts with `claude-opus-5-5`; for the others, test first and
   pick from the models the key can use). The base URL is filled in; change it only for another
   region (for example Qwen or Kimi in mainland China) or for **Other (OpenAI-compatible)**.
3. **Add and test** saves the key and checks it straight away by listing the provider's
   models. **Test** checks it again later. A failed test says why (rejected key, wrong address,
   unreachable).

![Adding an AI provider](images/guide/39-admin-ai-providers.png)

How your keys are protected:

- Keys are **encrypted** (AES-256-GCM) with `LOOP_SECRETS_KEY`, which lives only in `.env`,
  never in the database. A database backup alone reveals no key.
- After saving, a key is **never shown again**: only its last four characters. To change it,
  edit the provider and paste a new one; leave the field empty to keep the saved key.
- If `LOOP_SECRETS_KEY` changes, saved keys are marked **Locked** and must be entered again.
  **Back up `.env` apart from the database.**
- The server has **no general internet access**. A small egress gateway lets it reach only the
  hosts of **enabled** providers, over HTTPS (the page lists them). Disabling or deleting a
  provider closes its host again.
- Every change and test is recorded in the audit log (without the key).

Agents connected through Claude Code, Cursor or VS Code keep using their own subscription. To
let a provider's model play roles on a project, add an **API agent** (next section).

### API agents: a provider's model plays chosen roles

An **API agent** is an agent Loop Coder runs itself, with one of your AI providers, billed by the
provider per token. It works the board exactly like a connected Claude Code session: it fetches
the next step, plays the role, writes code in its own git worktree, posts remarks and moves the
item on. Use it, for example, to let Gemini build features while Claude Code reviews and tests.

**One-time setup on the server.** In the Loop Coder folder, run `npm run secrets-key` (it also
adds `LOOP_RUNNER_SECRET` to `.env`, without showing it), then `npm run up`. This starts the
**runner**, the container that runs API agents. Until then the Agent tab says the runner is not
set up.

**Add one** (administrators): open the project's **Agent** tab, go to **API agents** and click
**Add API agent**:

| Field | What it does |
|---|---|
| **Name** | How the agent appears on the board and in the office, for example *Gemini builder*. |
| **AI provider** | One of the enabled providers from Administration → AI providers. |
| **Model** | Leave empty for the provider's default model, or type another (models from the provider's last **Test** are suggested). |
| **Roles this agent plays** | *Every role*, or only the ones you tick, for example *Backend* and *Frontend Developer*. It gets only work for these roles. Only an agent that plays the **Project Manager** runs the kickoff, planning and reviews, so make sure some agent does. |
| **Daily token limit** | Input plus output tokens per day (UTC), 2,000,000 by default. When it is spent, the agent waits until the next day. |
| **Tool rounds per step** | At most this many model calls for one step (one stage of one item, or one ceremony); 60 by default. |
| **Can run commands** | On: it may run shell commands (git, builds, tests) in its folders. Off: it can only read and write files. |

![API agents on the Agent tab](images/guide/40-api-agents.png)

![Adding an API agent for chosen roles](images/guide/41-add-api-agent.png)

Then click **Start**. Within a few seconds the runner picks it up; the line under its name shows
what it is doing (for example *CANDLE-12: you are acting as the Backend Developer*), any error,
and today's tokens and requests. **Stop** stops it after its current model call; **Pause**,
**Resume** and **Stop** on the board work for it like for any agent. **Edit** changes its model,
roles or limits from its next step; **Delete** stops it, revokes its access and hands back the item it was working on, so another
agent (for example your Claude Code session, if it plays that role) takes it over at once.

How API agents are kept safe:

- **The runner never sees your API keys.** Its model requests go to Loop Coder's model relay,
  which adds the key, uses the model you chose (the agent cannot pick another), refuses requests
  once the daily limit is spent, and counts the tokens.
- **Each agent has its own access token**, limited to its project and roles, kept encrypted with
  `LOOP_SECRETS_KEY` and renewed automatically. It is never shown.
- **Files and commands run as an unprivileged user** in the runner container, with a clean
  environment: they cannot read the agent's token or anything else the runner holds. Paths are
  limited to the project folder and its worktrees, and commands are stopped after their timeout
  together with anything they started.
- **No internet** for the runner: it reaches only Loop Coder's API. Installing packages from the
  internet inside an agent's command therefore fails; dependencies must already be in the
  project (or install them yourself), or the agent asks for help with *Needs human*.
- Creating, changing, starting, stopping and deleting API agents is recorded in the audit log.

> [!NOTE]
> For Claude models, API agents use adaptive thinking and Anthropic's server-side **refusal
> fallbacks** (`fallbacks: "default"`): if the model declines a request, Anthropic retries it on
> its recommended fallback model, billed at that model's rates. Other providers are used through
> their OpenAI-compatible API.

---

## 18. Dark mode and mobile

Loop Coder follows your system's light or dark preference unless you choose one in the
sidebar.

![Dark mode](images/guide/32-board-dark.png)

On a phone, open the navigation with the menu button at the top left. Scroll the board
sideways to see all columns.

![Mobile view](images/guide/33-mobile-board.png)

---

## 19. Troubleshooting and FAQ

Answers to the questions people ask most often, from a paused agent to a locked account.

**The agent says "STATUS: PAUSED".** Someone paused the project. The agent keeps waiting and
carries on when you click **Resume agent** on the board. If it says **STOPPED**, someone stopped
it: click **Resume agent**, then start the agent again from your coding agent. If it says
**DISABLED**, an administrator has turned off agent work under Administration → Settings.

**The agent says "STATUS: WAITING".** Nothing can move without people. Check **Needs Human**,
items assigned to a human owner, and items whose dependencies are not done. The agent waits
and carries on as soon as you answer or free up an item.

**The agent cannot connect (401 Unauthorized).** The token is wrong, expired or revoked, or
the `Bearer ` prefix is missing from the header. Create a new token on the Agent tab.

**Claude Code does not show the `loopcoder` server.** You added it in a different folder. Run
the `claude mcp add` command inside the project folder, or add `--scope user`.

**The Files tab is empty.** The agent has not written any code yet, or it is working in a
different folder than the one shown on the Agent tab.

**"Invalid setup code".** Read the latest code from the server log. If `SETUP_CODE` is not
set, the code changes every time the server restarts.

**My account is locked.** Wait 15 minutes or ask an administrator to unlock it.

**Can several agents work on the same project?** Yes. Each one claims different items, and
every card shows which agent is working on it.

**Can I keep working on the board while the agent works?** Yes. Changes from both sides
appear live. If you move an item the agent is working on to another column, its claim is released.

**Does my code leave my computer?** Loop Coder itself never sends your code anywhere. It runs
in Docker on your machine. Your AI agent uses its own provider (for example Anthropic for
Claude Code) according to that tool's settings. **API agents** send what they read (instructions,
board content and the files they open) to the AI provider you chose for them.

**An API agent stays "Starting…".** The runner is not running or not set up: run
`npm run secrets-key` and `npm run up` on the server, and check `docker compose logs runner`.

**An API agent stopped with an error.** The line under its name says why, for example a rejected
key or an unknown model (check the provider with **Test** under Administration → AI providers), or
that it failed three times in a row. Fix the cause and click **Start** again.

**An API agent's command cannot install packages.** The runner has no internet access by design.
Install the project's dependencies yourself, or let a connected Claude Code session do steps that
need them.

---

*Screenshots are generated automatically from a demo project with `npm run docs:screenshots`.*

**There is no sound in the office.** Click the map or the menu first: browsers only play
sound after you interact with the page. Then check **Sound effects** and the volumes in the
game menu, and that the browser tab is not muted.
