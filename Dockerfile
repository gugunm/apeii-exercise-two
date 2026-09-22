# Build context adalah root repository (compose ada di root, `context: .`).
#   docker compose up -d --build

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# --- Dependensi ---------------------------------------------------------
# Dipisah agar layer install hanya dibangun ulang ketika manifest berubah.
# `pnpm-workspace.yaml` wajib ikut karena memuat `allowBuilds`.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Build aplikasi -----------------------------------------------------
# `tsc` mengompilasi `src/` ke `dist/` (dist/index.js = API, dist/worker.js = worker).
FROM deps AS builder
WORKDIR /app
COPY . .
RUN pnpm build

# --- Migrasi database ---------------------------------------------------
# `drizzle-kit` adalah devDependency sehingga tidak ikut ke image runtime.
# Stage ini dipakai service `migrate` lewat
# `docker compose --profile migrate run --rm migrate`.
FROM deps AS migrate
WORKDIR /app
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
CMD ["pnpm", "db:migrate"]

# --- Runtime ------------------------------------------------------------
# @hono/node-server listen di 0.0.0.0:3000. Worker memakai image sama dengan
# `command: ["node", "dist/worker.js"]` di compose.
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
