# Local Development

This folder contains a Docker Compose setup for running the app and a Postgres database locally.

Files:
- `docker-compose.yml` — starts `db` (Postgres) and `app` (built from repository Dockerfile).
- `app.env` — example environment file. Copy and fill values before `docker compose up`.

Persistence mapping (created next to this folder):
- `local-dev/postgres-data` → Postgres data directory (persistent DB storage).

Quick start:
1. Copy env: `cp local-dev/app.env local-dev/app.env` and edit values.
2. From `local-dev/` run: `docker compose up --build`.
3. App will be available at `http://localhost:8082`.

Notes:
- The compose `app` service mounts `../db` and `../public` so you can edit migrations and static files locally.
- After changing Go code, rebuild with `docker compose up --build`.

