# Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the API and its BullMQ worker with a multi-stage Dockerfile, and orchestrate them plus a local Redis via docker-compose, keeping PostgreSQL and S3 as external services configured through environment variables.

**Architecture:** One multi-stage `Dockerfile` produces a lean production image (compiled `dist/` + production-only `node_modules`) plus a one-shot `migrate` image (dev deps + `drizzle/`). `docker-compose.yml` runs four services: `redis` (local, persisted), `migrate` (runs `drizzle-kit migrate` against the external DB then exits), `api` (`node dist/index.js`), and `worker` (`node dist/worker.js`). `api` and `worker` share the same image and depend on `redis` (healthy) and `migrate` (completed). The database and S3 are never containerized — their URLs come from `.env`, with `REDIS_URL` overridden in-compose to the internal `redis` service.

**Tech Stack:** Docker (BuildKit) multi-stage builds, Node.js 22 (`node:22-bookworm-slim`), pnpm 11 via Corepack, docker-compose spec v2, Redis 7, Drizzle Kit for migrations.

**Spec:** No separate design doc — requirements captured directly from the request: "Dockerfile + docker-compose to deploy this project and its supported apps such as local Redis; keep database and S3 external." This plan is the authoritative artifact.

## Global Constraints

- Node runtime: `node:22-bookworm-slim` (Debian glibc — avoids musl native-build pain for `msgpackr-extract`/`esbuild`; project requires Node ≥ 22.13).
- Package manager: pnpm via `corepack enable` (repo is pinned to pnpm 11.x; use `--frozen-lockfile`).
- Build command is `pnpm build` = `tsc -p tsconfig.build.json`; it emits ESM to `dist/` (`rootDir: ./src`, `outDir: ./dist`, project `package.json` has `"type": "module"`). Entry points after build: `dist/index.js` (API, listens on port **3000**, hardcoded in `src/index.ts`) and `dist/worker.js`.
- Health endpoint: `GET /health` is public (registered before `apiKeyAuth`) and returns 200 — use it for the API healthcheck.
- External services (never containerized): PostgreSQL (`DATABASE_URL`) and S3 (`S3_*`). Local service: Redis (`REDIS_URL`).
- Compose file lives in `docker/`, so build `context: ..` and `env_file: ../.env`.
- `REDIS_URL` MUST be overridden in compose `environment:` to `redis://redis:6379` (the `.env` default points at `127.0.0.1`, unreachable from inside a container).
- Required env keys (from `.env.example`): `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `REDIS_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_SERVER_SIDE_ENCRYPTION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `BSRE_BASE_URL`, `BSRE_USERNAME`, `BSRE_PASSWORD`, `BSRE_ID_SUBSCRIBER`, `BSRE_SEAL_IMAGE_KEY`, `ESEAL_MAX_FILES`, `ESEAL_MAX_FILE_BYTES`, `ESEAL_SIGNED_URL_TTL`, `ADMIN_API_KEY`.
- Verification is Docker-level (build succeeds, container serves `/health`, `compose config` validates), not unit tests — there is no test framework for infra here.

---

### Task 1: Build-context ignore file

**Files:**
- Create: `.dockerignore` (project root)

**Interfaces:**
- Produces: a `.dockerignore` that keeps the build context to source + manifests + migrations, excluding secrets and generated artifacts. Later tasks' `docker build` rely on this to avoid copying `node_modules`, `dist`, or `.env` into the image.

- [ ] **Step 1: Write `.dockerignore`**

Create `.dockerignore` at the repo root:

```
# dependencies & build output (rebuilt in-image)
node_modules
dist

# secrets & local env (injected at runtime via env_file/environment)
.env
.env.*
!.env.example

# vcs & tooling
.git
.gitignore
.gitattributes
.vscode
.claude

# docs & the docker files themselves (not needed inside the image)
docs
docker

# misc
*.log
.DS_Store
```

- [ ] **Step 2: Verify it excludes the right paths**

Run: `git check-ignore -v node_modules dist .env || true` (sanity that these are already git-ignored) and confirm `.dockerignore` lists `node_modules`, `dist`, `.env`.
Expected: the file exists and contains those entries. `drizzle/`, `src/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json` are **not** ignored (they are needed by the build/migrate stages).

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore(docker): add .dockerignore"
```

---

### Task 2: Multi-stage Dockerfile

**Files:**
- Create: `docker/Dockerfile` (currently an empty placeholder)

**Interfaces:**
- Consumes: `.dockerignore` (Task 1); repo `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.build.json`, `src/`, `drizzle.config.ts`, `drizzle/`.
- Produces: two build targets used by compose in Task 3 —
  - `runtime`: production image, default `CMD ["node", "dist/index.js"]`, exposes 3000, has a `/health` HEALTHCHECK. The worker reuses this image with `command: ["node", "dist/worker.js"]`.
  - `migrate`: one-shot image, `CMD ["pnpm", "db:migrate"]`, contains dev deps + `drizzle/` + `drizzle.config.ts`.

- [ ] **Step 1: Write `docker/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ---- base: node + pnpm via corepack ----
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ---- deps: full dependency graph (incl. dev) for building & migrating ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: compile TypeScript to dist/ ----
FROM deps AS build
COPY tsconfig.build.json tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---- prod-deps: production-only node_modules ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- migrate: one-shot drizzle migrations against the external DB ----
FROM deps AS migrate
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
CMD ["pnpm", "db:migrate"]

# ---- runtime: lean production image (API by default; worker overrides CMD) ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```

Notes for the implementer:
- `pnpm build` runs `tsc`; `typescript` is a devDependency, so the `build` stage (which has dev deps) is where compilation happens. The `runtime` stage copies only the compiled `dist/` plus `--prod` `node_modules`.
- The `migrate` stage inherits `deps` (dev deps present) because `drizzle-kit` is a devDependency and `db:migrate` = `drizzle-kit migrate`.
- The healthcheck uses Node's global `fetch` (Node 22) instead of `curl`/`wget`, which `bookworm-slim` does not ship.

- [ ] **Step 2: Build the runtime image**

Run: `DOCKER_BUILDKIT=1 docker build --target runtime -t tte-eseal-app:test -f docker/Dockerfile .`
Expected: build completes without error; the final image is created.

- [ ] **Step 3: Verify the compiled entry points exist in the image**

Run: `docker run --rm tte-eseal-app:test ls -1 dist/index.js dist/worker.js`
Expected: both paths print (no "No such file" error).

- [ ] **Step 4: Build the migrate image**

Run: `DOCKER_BUILDKIT=1 docker build --target migrate -t tte-eseal-migrate:test -f docker/Dockerfile .`
Expected: build completes; `docker run --rm tte-eseal-migrate:test pnpm exec drizzle-kit --help` prints drizzle-kit usage (confirms dev deps + CLI are present). Do **not** run `db:migrate` here (no DB configured yet).

- [ ] **Step 5: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(docker): multi-stage Dockerfile for api, worker, migrate"
```

---

### Task 3: docker-compose orchestration

**Files:**
- Create: `docker/docker-compose.yml` (currently an empty placeholder)
- Modify: `package.json` (add a `start:worker` script for parity with `start`)

**Interfaces:**
- Consumes: Dockerfile targets `runtime` and `migrate` (Task 2); `../.env` at run time.
- Produces: services `redis`, `migrate`, `api`, `worker`. `api` publishes `3000:3000`. `api`/`worker` set `REDIS_URL=redis://redis:6379` and wait on `redis` healthy + `migrate` completed.

- [ ] **Step 1: Add the worker start script**

In `package.json` `scripts`, add after the existing `"start"` line:

```json
    "start:worker": "node dist/worker.js",
```

(The compose `worker` service invokes `node dist/worker.js` directly; this script is for running the worker outside compose.)

- [ ] **Step 2: Write `docker/docker-compose.yml`**

```yaml
name: tte-eseal

services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  migrate:
    build:
      context: ..
      dockerfile: docker/Dockerfile
      target: migrate
    image: tte-eseal-migrate:latest
    env_file: ../.env
    restart: "no"

  api:
    build:
      context: ..
      dockerfile: docker/Dockerfile
      target: runtime
    image: tte-eseal-app:latest
    env_file: ../.env
    environment:
      REDIS_URL: redis://redis:6379
    ports:
      - "3000:3000"
    depends_on:
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped

  worker:
    image: tte-eseal-app:latest
    command: ["node", "dist/worker.js"]
    env_file: ../.env
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped

volumes:
  redis-data:
```

Notes for the implementer:
- `worker` has no `build:` — it reuses the `tte-eseal-app:latest` image that `api` builds, so the app image is built once. Run `docker compose build api migrate` before the first `up`, or `docker compose up --build`.
- `migrate` uses `restart: "no"` and runs to completion; `api`/`worker` block on it via `service_completed_successfully`. If the external DB is unreachable, `migrate` fails and `api`/`worker` will not start — that is intentional.
- `redis` publishes no host port (internal-only). Add `ports: ["6379:6379"]` only if you need host access for debugging.
- `environment.REDIS_URL` overrides whatever `REDIS_URL` is in `../.env`, pointing the app at the compose-internal `redis` service.

- [ ] **Step 3: Validate the compose file resolves**

Run: `docker compose -f docker/docker-compose.yml config`
Expected: prints the fully-resolved config with all four services and no error. Confirm `api.environment.REDIS_URL` shows `redis://redis:6379` and `api.ports` maps `3000`.

- [ ] **Step 4: Commit**

```bash
git add docker/docker-compose.yml package.json
git commit -m "feat(docker): compose for redis, migrate, api, worker"
```

---

### Task 4: End-to-end smoke test

**Files:** none (runtime verification only).

**Interfaces:**
- Consumes: Task 2 image, Task 3 compose file, a populated `.env`.

- [ ] **Step 1: Prepare env for containers**

Ensure `../.env` exists (copy from `.env.example` and fill values). For the smoke test the DB/S3 do not need to be reachable to serve `/health`, but `migrate` needs a reachable `DATABASE_URL`. To exercise `api` + `redis` only (no DB), start those two services directly (next step). If a real external DB is available, set `DATABASE_URL` accordingly; when the DB runs on the Docker host, use `host.docker.internal` instead of `127.0.0.1`.

- [ ] **Step 2: Bring up redis + api (DB-independent path)**

Run:
```bash
docker compose -f docker/docker-compose.yml build api
docker compose -f docker/docker-compose.yml up -d redis
docker compose -f docker/docker-compose.yml run --rm --service-ports \
  --no-deps api node dist/index.js &
sleep 5
```
`--no-deps` skips the `migrate` gate so the API starts without a reachable DB (the DB client connects lazily and `/health` needs neither DB nor Redis).

- [ ] **Step 3: Verify the health endpoint**

Run: `curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health`
Expected: `200`.

- [ ] **Step 4: Verify Redis service is healthy**

Run: `docker compose -f docker/docker-compose.yml ps redis`
Expected: `redis` shows `(healthy)`.

- [ ] **Step 5: Full stack with migrations (requires a reachable external DB)**

Only if an external Postgres is reachable and `DATABASE_URL` is set in `../.env`:
```bash
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml logs migrate
docker compose -f docker/docker-compose.yml logs worker
```
Expected: `migrate` logs `✅ migration success` and exits 0; `worker` logs no crash (it connects to `redis://redis:6379`); `api` container status is `(healthy)`. If no external DB is available in this environment, record that Step 5 was skipped and DB-gated startup could not be exercised — Steps 2–4 already prove image build, API boot, `/health`, and Redis.

- [ ] **Step 6: Tear down**

Run: `docker compose -f docker/docker-compose.yml down` (add `-v` to also drop the `redis-data` volume). Stop the backgrounded `run` from Step 2 if still attached.

---

### Task 5: Deployment documentation

**Files:**
- Modify: `README.md` (append a "Docker deployment" section)

**Interfaces:**
- Consumes: the compose file and env keys from earlier tasks.

- [ ] **Step 1: Append the deployment section to `README.md`**

Add this section at the end of `README.md`:

```markdown
## Docker deployment

The app runs as two processes (HTTP API + BullMQ worker) plus a local Redis.
PostgreSQL and S3 are **external** — point the app at them via `.env`.

### Prerequisites
- Docker with BuildKit and the Compose plugin.
- A reachable PostgreSQL (`DATABASE_URL`) and S3-compatible store (`S3_*`).

### Configure
1. `cp .env.example .env` and fill every value (see `.env.example`).
2. Leave `REDIS_URL` as-is — compose overrides it to `redis://redis:6379`.
   Set `DATABASE_URL`/`S3_*` to your external services. If the database runs
   on the Docker host, use `host.docker.internal` rather than `127.0.0.1`.

### Run
```bash
docker compose -f docker/docker-compose.yml up -d --build
```
This starts `redis`, runs `migrate` (Drizzle migrations) to completion, then
starts `api` (published on `http://localhost:3000`) and `worker`.

- Health: `curl localhost:3000/health` → `{"status":"..."}`.
- Logs: `docker compose -f docker/docker-compose.yml logs -f api worker`.
- Stop: `docker compose -f docker/docker-compose.yml down` (`-v` also removes
  the Redis volume).

### Services
| Service | Image target | Purpose |
| --- | --- | --- |
| `redis` | `redis:7-alpine` | Local queue backend (persisted volume `redis-data`) |
| `migrate` | `migrate` | One-shot `drizzle-kit migrate`, then exits |
| `api` | `runtime` | `node dist/index.js`, port 3000 |
| `worker` | `runtime` | `node dist/worker.js`, BullMQ consumer |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document Docker deployment"
```

---

## Self-Review

**Requirement coverage:**
- "Dockerfile" → Task 2 (multi-stage: `runtime` + `migrate`).
- "docker-compose for deploying this project and its supported apps" → Task 3 (`api`, `worker`, `migrate`).
- "such as local redis" → Task 3 `redis` service with persistence + healthcheck; `REDIS_URL` overridden to internal service.
- "keep database and S3 with external services" → no DB/S3 containers; `DATABASE_URL`/`S3_*` injected via `env_file`; documented in Tasks 3–5. No gaps.

**Placeholder scan:** every file (`.dockerignore`, `Dockerfile`, `docker-compose.yml`, README section, `package.json` line) is given in full. Verification steps are concrete commands with expected output. Task 4 Step 5 is explicitly conditional on a reachable DB with a stated fallback — not a placeholder.

**Consistency check:** image tags are consistent (`tte-eseal-app:latest` shared by `api`+`worker`; `tte-eseal-migrate:latest` for `migrate`; `:test` tags only in Task 2 local builds). Entry points match the build output (`dist/index.js`, `dist/worker.js`) confirmed against `tsconfig.build.json` (`rootDir: ./src`, `outDir: ./dist`) and `src/worker.ts`. `REDIS_URL=redis://redis:6379` matches the `redis` service name and default port. Port `3000` matches `src/index.ts` and the healthcheck URL. `pnpm db:migrate` matches the existing `package.json` script.
