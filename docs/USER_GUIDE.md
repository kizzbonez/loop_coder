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
9. [Work item details and answering questions](#9-work-item-details-and-answering-questions)
10. [Backlog and refinement](#10-backlog-and-refinement)
11. [Sprints](#11-sprints)
12. [Activity and files](#12-activity-and-files)
13. [Project settings](#13-project-settings)
14. [Your account and access tokens](#14-your-account-and-access-tokens)
15. [Administration](#15-administration)
16. [Dark mode and mobile](#16-dark-mode-and-mobile)
17. [Troubleshooting and FAQ](#17-troubleshooting-and-faq)

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
| **Role** | How the agent behaves in a given stage: Project Manager, Software Architect, UI/UX Designer, Software Engineer, Code Reviewer, QA Engineer, DevOps, Security or Technical Writer. |
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

Click **Create project token**. The token lets the agent act on **this project only**,
with your permissions. It is shown **once**, so copy it now. All snippets on the page fill in
the token automatically.

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

> [!TIP]
> Several agents can work on the same project at once, for example Claude Code building
> features while Cursor does QA. Create one token per agent so each is labelled correctly.

---

## 7. What the agent does

The agent always asks Loop Coder what to do next. Loop Coder answers like a Scrum Master
would, in this order:

1. **Kickoff** (once, as Project Manager): it reads your goal, writes the vision, tech stack
   and conventions into the project notes, and creates the first backlog of epics and stories.
2. **Sprint work** (pull from the right): it finishes items closest to **Done** before
   starting new ones, and respects dependencies and WIP limits. The role changes with the stage:
   - **In Progress**: the item's assigned role (Software Engineer by default, or Architect,
     UI/UX Designer, DevOps, Security, Technical Writer) does the real work in the code folder.
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

![Agent status and the pause button](images/guide/14-agent-status.png)

Click **Pause agent** to stop the agent from taking new work. It finishes its current step
and then reports that the project is paused. Click **Resume agent** to continue. Editors and
owners can pause and resume.

The line under the title shows the active sprint, its goal and progress, how many items are
done, and a red **waiting for you** badge when the agent needs an answer.

### Reading a card

![A card the agent is working on](images/guide/13-card-working.png)

- **Top row:** type icon (epic, story, task, bug, spike), the item key, a **draft** label if
  it is not refined yet, priority bars (more bars = higher priority), and the story points.
- **Title**, then the **epic** it belongs to and any **labels**.
- **Agent bar:** a glowing border and "*Claude Code is working as Software Engineer*" show
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

## 9. Work item details and answering questions

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

## 10. Backlog and refinement

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

## 11. Sprints

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

## 12. Activity and files

**Activity** is the project's live timeline: who did what and when. Filter it to the agents
or to people.

![Activity timeline](images/guide/20-activity.png)

**Files** shows the code in the project folder, read-only, as the agent writes it. Click
folders to expand them and files to view them.

![File browser](images/guide/21-files.png)

---

## 13. Project settings

Shape how the team works: the goal, the Definitions of Ready and Done, shared notes and the
board columns. Project owners find these settings under **Settings**.

![Project settings](images/guide/22-project-settings.png)

- **General:** name, goal and requirements, and **sprint capacity** in story points.
- **Agile agreements:** the **Definition of Ready** and **Definition of Done**. Every role
  checks them.
- **Project notes:** the team's shared memory. The agent records decisions, conventions and
  lessons here and reads them at every step. You can edit them too.
- **Board columns:** rename columns, change colours, set **WIP limits**, choose which **agent
  role** works each column, and whether the role comes from the column or from each item's
  assigned role.
- **Danger zone:** delete the project. You must type the project key to confirm. The code
  folder on disk is not touched.

---

## 14. Your account and access tokens

Manage your profile, password and signed-in browsers, and the tokens your agents use to
connect. Open **Account & tokens** in the sidebar.

![Account page](images/guide/25-account.png)

- **Profile:** your display name.
- **Access tokens:** create, see and revoke the tokens your agents use. Give each token a
  clear name, limit it to **one project or workspace** whenever you can, and choose an
  expiry. The token value is shown only once. Revoking it stops every agent using it immediately.
- **Password:** change it. All your other sessions are signed out.
- **Active sessions:** every browser signed in to your account. Sign out the ones you don't recognise.

---

## 15. Administration

Everything about the server in one place: users, workspaces, agent roles, security settings,
the audit log and backups. Administrators see **Administration** in the sidebar.

![Administration overview](images/guide/26-admin-overview.png)

| Page | What you can do |
|---|---|
| **Overview** | Users, workspaces, finished work, agents online, sessions and failed sign-ins in the last 24 hours, recent agent activity and security events. |
| **Users** | Create users, make or remove administrators, disable or enable accounts, unlock locked accounts, reset passwords, sign a user out everywhere, delete users (their workspaces are transferred to you). |
| **Workspaces** | Every workspace and project on the server; open or delete them. |
| **Agent roles** | Edit the instructions of the nine built-in roles, or add your own roles (for example a Data Engineer). |
| **Agent sessions** | Every agent connection: which tool, for which project, on whose behalf, how many tool calls and finished items. |
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

---

## 16. Dark mode and mobile

Loop Coder follows your system's light or dark preference unless you choose one in the
sidebar.

![Dark mode](images/guide/32-board-dark.png)

On a phone, open the navigation with the menu button at the top left. Scroll the board
sideways to see all columns.

![Mobile view](images/guide/33-mobile-board.png)

---

## 17. Troubleshooting and FAQ

Answers to the questions people ask most often, from a paused agent to a locked account.

**The agent says "STATUS: PAUSED".** Someone paused the project. Click **Resume agent** on the
board. If it says **DISABLED**, an administrator has turned off agent work under
Administration → Settings.

**The agent says "STATUS: WAITING".** Nothing can move without people. Check **Needs Human**,
items assigned to a human owner, and items whose dependencies are not done.

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
Claude Code) according to that tool's settings.

---

*Screenshots are generated automatically from a demo project with `npm run docs:screenshots`.*
