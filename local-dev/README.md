# Local Development

This folder contains a Docker Compose setup for running the app and a Postgres database locally.

Files:
- `docker-compose.yml` — starts `db` (Postgres), the Go backend (`app`), and the Next.js frontend (`next`) in dev mode.
- `app.env` — example environment file. Copy and fill values before `docker compose up`.

Persistence mapping (created next to this folder):
- `local-dev/postgres-data` → Postgres data directory (persistent DB storage).

Quick start:
1. Copy env: `cp local-dev/app.env.example local-dev/app.env` and edit values.
2. From `local-dev/` run: `docker compose up --build`.
3. Backend will be available at `http://localhost:8082`.
4. Frontend will be available at `http://localhost:3000`.

Dev iteration:
- Next.js: source is bind-mounted and `npm run dev` runs inside the container, so changes should pick up automatically.
- Go backend: after Go/db changes, rebuild and restart with `docker compose up --build`.

Notes:
- The compose `app` service mounts `../db` and `../public` so you can edit migrations and static files locally.
- After changing Go code, rebuild with `docker compose up --build`.
- The `app` service waits for the Postgres healthcheck before startup.
- Migration retries are configurable via `MIGRATE_MAX_ATTEMPTS` (default `30`) and `MIGRATE_RETRY_DELAY` (default `2s`).
- For verbose app/proxy logs, enable `DEV_LOG_REQUEST`, `DEV_LOG_RAW_RESPONSE`, `DEV_LOG_TOKEN_COUNT`, `DEV_LOG_TOKEN_DEBUG` in `local-dev/app.env`.
