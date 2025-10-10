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

Dev iteration (no image rebuild):
- Use the dev override to run the Go runtime directly (faster iteration):
  - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`
  - This starts `app-dev` (based on the `golang` image) and mounts the repository at `/app` so code edits take effect without rebuilding the image.
  - To stop: `docker compose down`.

Notes:
- `app-dev` runs `go run ./cmd/main.go`. You still must restart the container to pick up changes, but you do not need to rebuild the Docker image.
- For true hot reload, consider adding a file-watcher (e.g., `air` or `reflex`) into the dev container.

Notes:
- The compose `app` service mounts `../db` and `../public` so you can edit migrations and static files locally.
- After changing Go code, rebuild with `docker compose up --build`.
