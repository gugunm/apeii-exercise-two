# API Key Authentication Design

Date: 2026-09-21
Status: Draft — awaiting user review

Replaces the Unkey integration (`@unkey/hono`) added earlier. Unkey is a
hosted SaaS that verifies each key over the network; this design brings key
management fully in-house on the existing PostgreSQL + Drizzle stack. On
implementation, `@unkey/hono` is uninstalled and its middleware in
`src/app.ts` is removed.

## 1. Summary

A self-contained API key system protects the API. Keys are random 256-bit
secrets; only their SHA-256 hash is stored. Each key carries a set of
**scopes** (e.g. `eseal:write`). Requests present `Authorization: Bearer
<key>`. An `apiKeyAuth` middleware authenticates every `/api/v1/*` request
(valid, not revoked, not expired) and loads the key's scopes into context; a
`requireScope(...)` guard on each route enforces the scope needed for that
operation.

Keys are managed through admin-only HTTP endpoints under `/admin/keys`,
guarded by a static `ADMIN_API_KEY` from the environment. The Scalar docs
(`/docs`, `/openapi.json`) are placed behind the same admin guard. `/health`
stays public.

```text
Bearer <key> --hash--> lookup api_keys by key_hash --> check status/expiry --> check scope
```

### Not in scope

- User accounts or a `users` table (keys are standalone credentials)
- Rate limiting / quota per key
- Key rotation automation (revoke + create a new key manually)
- OAuth / JWT / session flows

## 2. Access map

| Path                | Guard         | Notes                                    |
| ------------------- | ------------- | ---------------------------------------- |
| `/health`           | none          | Public liveness probe                    |
| `/openapi.json`     | `adminAuth`   | Behind admin key                         |
| `/docs`             | `adminAuth`   | Scalar UI, behind admin key              |
| `/admin/keys/*`     | `adminAuth`   | Key CRUD                                  |
| `/api/v1/*`         | `apiKeyAuth`  | Then per-route `requireScope(...)`        |

## 3. Conventions

Follow the existing `e-seal` / `doc-summary` modules:

- IDs: `char(26)` ULID via `$defaultFn(() => ulid())`
- Timestamps: `created_at`, `updated_at` (`$onUpdate`), all `timestamptz`,
  via the shared `timestamps` helper
- DB client: `db` from `src/utils/db.ts`
- Module shape: `src/modules/<name>/{schema.ts, service.ts, router.ts}`,
  routes chained on `app` in `src/app.ts` so `AppType` stays typed
- Validation: `@hono/zod-validator` with Zod schemas in `schema.ts`
- Tests: `*.test.ts` beside source, run with `node --test`

## 4. Database schema

File: `src/db/schema/api-key.schema.ts`. Export from
`src/db/schema/index.ts`.

### `api_keys`

| Column        | Type          | Notes                                             |
| ------------- | ------------- | ------------------------------------------------- |
| `id`          | char(26)      | ULID, PK                                           |
| `name`        | varchar(255)  | Human label for the client/key. not null           |
| `key_hash`    | char(64)      | SHA-256 hex of the secret. not null, **unique**    |
| `prefix`      | varchar(16)   | Public display fragment, e.g. `tte_ab12cd`. not null |
| `scopes`      | text[]        | not null, default `[]`. e.g. `{eseal:read,eseal:write}` |
| `revoked_at`  | timestamptz   | null = active; set = revoked                        |
| `expires_at`  | timestamptz   | **null = never expires**; else hard expiry          |
| `last_used_at`| timestamptz   | Updated on successful auth (best-effort)            |
| `created_at`  | timestamptz   | default now                                         |
| `updated_at`  | timestamptz   | default now, `$onUpdate`                            |

Indexes:
- Unique index on `key_hash` (primary lookup path).

A key is **valid** when: `revoked_at IS NULL` AND (`expires_at IS NULL` OR
`expires_at > now()`).

## 5. Key format & hashing

- **Generation:** 32 random bytes from `crypto.randomBytes(32)`, encoded
  base64url. Final secret = `tte_<base64url>` (~43 chars body).
- **Prefix:** `prefix` column stores `tte_` + first 6 chars of the body, for
  identification in listings. It is not sufficient to authenticate.
- **Hash:** `key_hash = sha256_hex(fullSecret)`. Because the secret is a
  256-bit random value (not a low-entropy password), a single SHA-256 is
  sufficient; bcrypt/argon2 are unnecessary. Lookup is by exact `key_hash`,
  which is itself unguessable, so no per-request salt is needed.
- **Plaintext exposure:** the full secret is returned **once** in the create
  response and never stored or logged. Losing it means revoke + reissue.

Helper: `src/utils/api-key.ts` — `generateKey()` → `{ secret, prefix, hash }`,
`hashKey(secret)` → hex.

## 6. Scope model

- Scopes are strings shaped `resource:action`, plus wildcards.
- A key's `scopes` may contain exact scopes (`eseal:read`), resource
  wildcards (`eseal:*`), or the global wildcard (`*`).
- `requireScope(required)` passes when the key's scopes include `required`
  exactly, OR `<resource>:*` matching its resource, OR `*`.
- **Scope registry** (`KNOWN_SCOPES` in `src/middlewares/scopes.ts` or the
  api-key module): the canonical list used to validate scopes at key-create
  time (reject unknown scopes to prevent typos). Wildcards are accepted at
  create time against known resources.

Full route→scope map (from the current routers). Each protected route
declares its own `requireScope`:

```text
eseal:write       POST /api/v1/e-seal
eseal:read        GET  /api/v1/e-seal, /:id, /:id/files, /:id/files/:fileId/:kind
docsummary:write  POST /api/v1/doc-summary
docsummary:read   GET  /api/v1/doc-summary, /:id
```

`KNOWN_SCOPES` = the four exact scopes above; wildcards `eseal:*`,
`docsummary:*`, `*` are accepted at create time as valid grants.

## 7. Middleware

Directory: `src/middlewares/`.

### `apiKeyAuth()` — `src/middlewares/api-key-auth.ts`

Applied to `/api/v1/*`. Flow:

1. Extract Bearer token; missing → `401 { error: 'Unauthorized' }`.
2. `hashKey(token)`, look up `api_keys` by `key_hash`; not found → `401`.
3. Validity check (revoked / expired) → `401`.
4. Set `c.get('apiKey')` = `{ id, name, scopes }`.
5. Best-effort `last_used_at = now()` (fire-and-forget; failure never blocks
   the request).
6. `next()`.

App typing: `new Hono<{ Variables: { apiKey: ApiKeyContext } }>()` where
`ApiKeyContext = { id: string; name: string; scopes: string[] }`.

### `requireScope(...required: string[])` — same file or `scopes.ts`

Reads `c.get('apiKey').scopes`; if none of the required scopes are satisfied
→ `403 { error: 'Forbidden', missingScope }`. Placed per route in module
routers, e.g. `e-seal/router.ts`:

```ts
.post('/', requireScope('eseal:write'), zValidator('form', ...), handler)
.get('/', requireScope('eseal:read'), handler)
```

### `adminAuth()` — `src/middlewares/admin-auth.ts`

Compares the Bearer token to `process.env.ADMIN_API_KEY` using a
constant-time comparison (`crypto.timingSafeEqual` over equal-length
buffers). Missing/mismatch → `401`. Guards `/admin/*`, `/docs`,
`/openapi.json`. If `ADMIN_API_KEY` is unset, the guard fails closed (all
admin routes 401) and logs a startup warning.

## 8. Key management module

Directory: `src/modules/api-key/`.

### `schema.ts` (Zod)

- `CreateKeySchema`: `{ name: string(1..255), scopes: string[] (each in
  KNOWN_SCOPES or valid wildcard), expiresAt?: ISO datetime | null }`.
  Omitted/`null` `expiresAt` → never expires.
- `UpdateKeySchema`: `{ name?: string, scopes?: string[] }`.

### `service.ts`

- `createKey(input)` → generates secret, inserts row, returns
  `{ id, name, prefix, scopes, expiresAt, secret }` (secret = plaintext,
  once).
- `listKeys()` → rows without hash/secret; includes `prefix`, `scopes`,
  status (`active | revoked | expired`), `lastUsedAt`, timestamps.
- `getKey(id)` → single row (no secret) or null.
- `revokeKey(id)` → set `revoked_at = now()`; idempotent.
- `updateKey(id, patch)` → update name/scopes (validated).
- `verifyKey(token)` (used by middleware) → valid key row or null.

### `router.ts` (`apiKeyRoute`, mounted at `/admin/keys` under `adminAuth`)

| Method | Path            | Body                    | Result                          |
| ------ | --------------- | ----------------------- | ------------------------------- |
| POST   | `/`             | CreateKeySchema         | `201 { data: { ..., secret } }` (secret once) |
| GET    | `/`             | —                       | `200 { data: [...] }`           |
| GET    | `/:id`          | —                       | `200 { data }` / `404`          |
| PATCH  | `/:id`          | UpdateKeySchema         | `200 { data }` / `404`          |
| POST   | `/:id/revoke`   | —                       | `200 { data }` / `404`          |

Admin endpoints are internal; they are not added to the public OpenAPI
document (which itself sits behind the admin guard anyway).

## 9. Wiring `src/app.ts`

Remove the Unkey import and middleware. New shape:

```ts
export const app = new Hono<{ Variables: { apiKey: ApiKeyContext } }>();

app.get('/health', ...);                    // public

app.use('/openapi.json', adminAuth());
app.use('/docs', adminAuth());
app.use('/admin/*', adminAuth());           // single guard for all admin routes
app.get('/openapi.json', ...);
app.get('/docs', Scalar({ ... }));
app.route('/admin/keys', apiKeyRoute);      // apiKeyRoute itself carries no auth

app.use('/api/v1/*', apiKeyAuth());
const api = app.basePath('/api/v1')
  .route('/doc-summary', docSummaryRoute)
  .route('/e-seal', esealRoute);
export type AppType = typeof api;
```

`requireScope(...)` guards live inside `docSummaryRoute` / `esealRoute`.

## 10. Environment & migration

- `.env` / `.env.example`: remove `UNKEY_ROOT_KEY`, add `ADMIN_API_KEY=`.
- New Drizzle migration for `api_keys` via `pnpm db:generate` +
  `pnpm db:migrate`.
- Bootstrapping the first key: call `POST /admin/keys` with the admin key.

## 11. Testing

Follow `node --test` + `app.request` patterns already in the repo.

Service unit tests (`src/modules/api-key/service.test.ts`):
- generate → `verifyKey` roundtrip succeeds; wrong token fails.
- `hashKey` deterministic; plaintext never equals stored hash.
- revoked key → `verifyKey` null.
- expired key (`expires_at` in past) → null; `null` expiry → valid.

Scope tests (`src/middlewares/scopes.test.ts`):
- `requireScope('eseal:write')` passes for `eseal:write`, `eseal:*`, `*`;
  fails for `eseal:read`, `docsummary:*`, `[]`.

Middleware/integration (`src/app.test.ts` or module tests) via `app.request`:
- `/health` → 200 without key.
- `/api/v1/e-seal` no key → 401; bad key → 401; valid key wrong scope → 403;
  valid key right scope → 200; revoked key → 401.
- `/admin/keys` without admin key → 401; with admin key → 200.
- `/docs` without admin key → 401.

DB-touching tests assume a reachable `DATABASE_URL`; if the suite has no test
DB, those cases use a thin injectable store or are marked accordingly during
implementation (decided in the plan).

## 12. Security notes

- Only hashes stored; plaintext returned once, never logged.
- `adminAuth` uses constant-time comparison and fails closed when
  `ADMIN_API_KEY` is unset.
- `key_hash` unique index prevents duplicates and gives O(1) lookup.
- Revocation is immediate (DB check every request); no token caching.
- `last_used_at` writes are best-effort and must not affect the auth result.

## 13. Rollout / cutover

1. Add schema + migration.
2. Add helpers, middlewares, api-key module.
3. Add `requireScope` guards to `e-seal` and `doc-summary` routers.
4. Rewire `app.ts`; remove Unkey middleware/import.
5. `pnpm remove @unkey/hono`.
6. Update `.env` / `.env.example`.
7. Verify via tests + smoke test; create the first admin-issued key.
