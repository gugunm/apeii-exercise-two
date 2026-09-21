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
