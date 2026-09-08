# Coding Agent Guide

This repository contains an OpenAI-compatible Go API proxy and a separate
Next.js analytics application. Keep changes focused, preserve work already in
the checkout, and verify the smallest affected surface before handing work
off.

## Scope and precedence

This file applies from the repository root. `app/AGENTS.md` is the more
specific instruction file for everything under `app/`; read and follow it when
working on the analytics frontend. A nested guide takes precedence over this
file where the instructions differ. Changes that cross the `app/` boundary
(for example, a shared database migration used by both applications) must
follow both scopes.

Before editing, inspect `git status --short` and the relevant diff. Do not
overwrite, reformat, reset, stash, or revert unrelated user work. Make edits
only in files required by the request, and ask before broad refactors,
generated-file churn, data changes, or destructive/irreversible operations.

## Repository map

- `cmd/main.go` is the Go process entry point. It loads environment settings,
  initializes the database, registers HTTP routes, and serves on port `8082`.
- `api/` contains backend API and usage/admin endpoints. `auth/` contains
  authentication integration and API-key/web authentication behavior.
- `apiproxy/` implements upstream proxying, request validation, streaming,
  response usage accounting, and reranking behavior.
- `db/` contains PostgreSQL access code, `schema.sql`, and ordered Atlas
  migrations in `db/migrations/`. The database package applies migrations at
  startup and then applies the schema SQL.
- `costs/` contains pricing/collection logic. `webui/` wires the server-side
  web UI; `templates/` contains Go HTML templates and `public/` contains
  static HTML/assets.
- `app/` is an independent Next.js 15 / React 19 / TypeScript analytics
  frontend. It uses Drizzle against PostgreSQL and has its own `package.json`,
  lockfile, and `app/AGENTS.md`.
- `local-dev/` contains the Docker Compose development stack and
  `app.env.example`. `tools/azure-prices-helper/` is a separate Go helper;
  `docs/` contains requirements/findings, and `nix-modules/` contains
  formatting and test checks.

## Backend development

The root Go module is `openai-api-proxy`, requires Go `1.23`, and uses pgx for
PostgreSQL. The application reads `DATABASE_PATH` when present; otherwise it
builds a connection from `DATABASE_USERNAME`, `DATABASE_PASSWORD`,
`DATABASE_HOST`, and `DATABASE_NAME`. It also loads a `.env` file if one is
available, but secrets should normally be supplied through the environment.

From the repository root:

```bash
go build cmd/main.go
go run cmd/main.go
go test ./...
gofmt -l $(rg --files -g '*.go')
goimports -l $(rg --files -g '*.go')
```

`go build cmd/main.go` is the supported backend build. `go run cmd/main.go`
starts the server at `http://localhost:8082`; it requires valid database and
upstream/auth configuration. `go test ./...` runs the repository test suite;
tests currently live in `api/`, `apiproxy/`, and `db/`. The formatting checks
should produce no filenames. `goimports` is part of the repository's
pre-commit checks; use it when installed, and use `gofmt` for every Go change.
There is no repository-wide Go linter command documented here, so do not
invent one as a required check.

## Analytics frontend

When working under `app/`, first read `app/AGENTS.md`. Run frontend commands
from `app/`, not the repository root. With dependencies installed from the
committed lockfile (`npm ci`):

```bash
npm run dev
npm run build
npm run typecheck
npm run check
npm run check:write
npm run db:generate
npm run db:migrate
npm run db:push
npm run db:studio
```

These scripts respectively start Next.js development mode, create a
production build, run TypeScript without emitting files, check/fix Biome
formatting and lint rules, and run Drizzle's migration generation, migration,
push, and studio workflows. Prefer `npm run check` for a read-only check;
`check:write` modifies files and must be limited to the intended frontend
scope. Database commands require the frontend's `DATABASE_URL` and an
appropriate database. Run `npm run typecheck` and the checks/build required by
`app/AGENTS.md` for TypeScript or frontend changes.

## Local development with Docker Compose

The supported integrated development stack is defined in
`local-dev/docker-compose.yml`. It starts PostgreSQL (`db`), the Go backend
(`app`), and the Next.js frontend (`next`). From the repository root:

```bash
cp local-dev/app.env.example local-dev/app.env
# edit local-dev/app.env with suitable development credentials
cd local-dev
docker compose up --build
```

The backend is available at `http://localhost:8082`, the frontend at
`http://localhost:3000`, and PostgreSQL is exposed on host port `54329`.
Database data is persisted in `local-dev/postgres-data`; do not delete it
without explicit confirmation. The backend waits for the database healthcheck
and retries migrations by default up to 30 times with a 2-second delay. These
values can be changed with `MIGRATE_MAX_ATTEMPTS` and
`MIGRATE_RETRY_DELAY`. Go/database changes require rebuilding the Compose app;
frontend source is bind-mounted for development. Use `docker compose down`
when stopping the stack, and ask before removing volumes or persistent data.

## Database and migration rules

PostgreSQL is the database described by the backend and Compose configuration.
Atlas applies the ordered SQL files in `db/migrations/` during backend startup.
`db/schema.sql` is also loaded at initialization, so schema changes must keep
the migration history and schema definition consistent.

For a schema change, add a new timestamped migration in `db/migrations/`; do
not rewrite or delete an applied migration. Review SQL for forward behavior,
indexes, constraints, nullability, existing-data compatibility, and
rollback/operational implications. Update related Go access code and frontend
Drizzle schema/code as needed, and test fresh and populated databases when
practical. Do not run `db:migrate`, `db:push`, Atlas, or destructive SQL
against a shared/production database without explicit authorization. Confirm
generated migration output and checksum changes before committing.

## Coding and change guidance

Keep handlers and proxy paths small, validate errors at boundaries, and keep
package responsibilities separated. Follow existing Go naming and formatting:
lowercase package names, PascalCase exported identifiers, camelCase locals,
and `gofmt`/`goimports`. Use parameterized SQL with the existing database APIs;
never construct SQL from request values. Use `html/template` escaping for HTML
and preserve existing response and streaming semantics.

For frontend changes, follow `app/AGENTS.md` and existing TypeScript/React
patterns. Keep generated Drizzle metadata and lockfiles consistent with the
command that produced them. Add or update focused tests adjacent to changed Go
behavior, especially proxy validation, response accounting, authentication,
and database logic.

## Security and operations

Treat HTTP bodies, headers, query parameters, model names, URLs, file paths,
and tool/database inputs as untrusted. Validate and bound them against declared
schemas before use. In particular:

- Use parameterized queries and allowlisted identifiers to prevent SQL
  injection. Never pass untrusted input to a shell or command executor; avoid
  command injection with direct APIs and strict argument validation.
- Protect outbound requests against SSRF: validate schemes, hosts, ports,
  redirects, and destinations against explicit policy. Bound request/response
  sizes and timeouts, and do not follow arbitrary user URLs.
- Prevent path traversal by resolving paths within an intended directory,
  rejecting traversal/absolute-path escapes, and avoiding user-controlled file
  names where possible.
- Enforce authentication and authorization separately. Check identity and
  required scope/ownership/admin privilege at every sensitive operation; use
  least-privilege database and upstream credentials.
- Keep API keys, OIDC secrets, database URLs/passwords, and upstream
  credentials out of source, commits, errors, and logs. Redact authorization
  headers, cookies, connection strings, payloads, and raw upstream responses.
  Development-only verbose logging in `local-dev/app.env.example` is opt-in.
- Prefer TLS for database, authentication, and upstream connections outside
  local development. Use secure, HttpOnly, appropriately scoped cookies and
  explicit origin/CSRF protections when changing authentication flows.
- Require confirmation before irreversible actions such as deleting keys/data,
  dropping columns, resetting persistent volumes, or changing production
  configuration. Plan migrations and rollouts for partial failure.
- Add structured observability around outcomes, error classes, latency,
  retries, and usage/cost counters without exposing credentials or payloads.

When modifying operations, document new environment variables, limits, retry
behavior, and failure modes. Do not weaken validation, authorization, TLS,
redaction, or resource limits merely to make a test pass.

## Agent workflow and handoff

1. Read this guide and any more-specific guide, inspect status/diffs, and map
   the request to the smallest set of packages/files.
2. Confirm assumptions from the checkout. Ask before broad refactors,
   dependency upgrades, generated changes outside the task, data-destructive
   commands, or external/production operations.
3. Implement the focused change while preserving unrelated worktree edits.
4. Format and run targeted validation. For backend changes use `gofmt`,
   `goimports` where available, targeted Go tests, and
   `go build cmd/main.go`; for frontend changes use the required scripts from
   `app/AGENTS.md`. Do not claim a command passed unless it ran.
5. Review `git diff` and `git status --short` again. Report changed files,
   validation performed, skipped checks and reasons, migration impact, and
   remaining operational risk. Never include secrets in the handoff.

