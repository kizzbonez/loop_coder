# Development

## Setup

```bash
npm install            # Node 22+; better-sqlite3 uses its bundled prebuilt binary (no compiler needed)
npm run dev:api        # http://localhost:3000, SQLite at ./data/loopcoder.db (gitignored)
npm run dev:web        # http://localhost:5173, proxies /api and /mcp to :3000
```

The dev API reads `.env` from the repository root if present. On first start it prints the
setup code. Set `SETUP_CODE=…` in `.env` to keep it fixed while developing.

## Database changes

1. Edit `apps/api/src/db/schema.ts`.
2. `npm run db:generate` writes a new SQL migration to `apps/api/drizzle/`.
3. Commit the migration. It is applied automatically at the next start, in dev, in tests
   and in Docker.

## Tests

| Command | What runs |
|---|---|
| `npm test` | API unit and integration tests (Vitest + Supertest, each file on its own in-memory SQLite) and web unit/component tests (Vitest + Testing Library + jsdom). |
| `npm run test:coverage` | API tests with V8 coverage (`apps/api/coverage`). |
| `npm run e2e` | Builds the images, starts an isolated stack on port 18090 (project `loopcoder-e2e`, its own volume), runs the Playwright specs in Chromium, then tears it down. `E2E_KEEP=1` keeps the stack running. Screenshots are saved to `e2e/.screenshots`, the HTML report to `e2e/.report`. |

The API suite covers setup, authentication and lockout, sessions, CSRF and headers, rate
limiting, authorisation boundaries, workspaces and members, projects and columns, work
items (dependencies, cycles, epics, ordering), sprints and burndown, the file browser, the
admin console, MCP transport and scopes, realtime streams, and the complete agent workflow
end to end.

## Conventions

- Business rules live in `modules/*/*.service.ts`. Routes and MCP tools only validate and delegate.
- Validate every input with the schemas from `@loop/shared`.
- Use `requireProjectAccess` / `requireWorkspaceAccess` in every service entry point.
- Publish realtime events through an `EventBatch`, flushed after the transaction commits.
- Record user-visible changes with `recordActivity`, and security-relevant ones with `audit`.
- UI colours come from the design tokens in `apps/web/src/styles.css` (`bg-surface`,
  `text-muted`, `text-accent`, …), so light and dark themes both work.
