# API Key Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Unkey SaaS integration with a self-contained, DB-backed API key system that protects `/api/v1/*` by key + scope, with admin-only key management.

**Architecture:** Random 256-bit keys stored as SHA-256 hashes in a Postgres `api_keys` table (Drizzle). An `apiKeyAuth` middleware authenticates every `/api/v1/*` request and loads scopes into context; per-route `requireScope(...)` guards enforce scope. Admin CRUD lives under `/admin/keys` behind a static `ADMIN_API_KEY`. Pure logic (key gen, scope matching, validity) is unit-tested; middleware is tested via `app.request` with an injected `verifyKey`, matching the repo's dependency-injection test style. No test touches a live database.

**Tech Stack:** TypeScript (ESM, NodeNext), Hono v4, Drizzle ORM (node-postgres), Zod v4, `@hono/zod-validator`, `node:crypto`, `node:test` + `node:assert/strict`, ULID.

**Spec:** `docs/superpowers/specs/2026-09-21-api-key-auth-design.md`

## Global Constraints

- Module shape: `src/modules/<name>/{schema.ts, service.ts, router.ts}`; routes are chained on `app` in `src/app.ts` so `AppType` stays typed.
- IDs: `char(26)` ULID via `$defaultFn(() => ulid())`.
- Timestamps: `timestamptz` columns `created_at`, `updated_at` (`$onUpdate`), via a local `timestamps` helper as in `e-seal.schema.ts`.
- DB client: `db` from `src/utils/db.ts`. Services use it directly (as `e-seal/service.ts` does).
- Imports use explicit `.js` extensions (NodeNext).
- Tests: `node:test` + `node:assert/strict`, files `*.test.ts` beside source, run with `pnpm test` (`node --import tsx --test 'src/**/*.test.ts'`). No test may require a reachable `DATABASE_URL`.
- Secrets: only SHA-256 hashes are stored; plaintext key returned once, never logged.
- Frequent commits: one commit per task.

---

### Task 1: `api_keys` schema + migration

**Files:**
- Create: `src/db/schema/api-key.schema.ts`
- Modify: `src/db/schema/index.ts` (add export)
- Generated: `drizzle/<timestamp>_<name>/` migration

**Interfaces:**
- Produces: `apiKeys` Drizzle table with columns `id, name, keyHash, prefix, scopes, revokedAt, expiresAt, lastUsedAt, createdAt, updatedAt`. Row type `typeof apiKeys.$inferSelect`.

- [ ] **Step 1: Write the schema**

`src/db/schema/api-key.schema.ts`:

```ts
import {
  pgTable,
  char,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ulid } from 'ulid';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const apiKeys = pgTable(
  'api_keys',
  {
    id: char('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    name: varchar('name', { length: 255 }).notNull(),
    keyHash: char('key_hash', { length: 64 }).notNull(),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('api_keys_key_hash_idx').on(t.keyHash)],
);
```

- [ ] **Step 2: Export from the barrel**

Modify `src/db/schema/index.ts`, append:

```ts
export * from './api-key.schema.js';
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new folder under `drizzle/` containing SQL that creates `api_keys` and the unique index on `key_hash`. Open the `.sql` file and confirm it has `CREATE TABLE "api_keys"` and `CREATE UNIQUE INDEX "api_keys_key_hash_idx"`.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: prints `✅ migration success`. (Requires a reachable dev DB. If none is available in this environment, skip applying and note it — the generated SQL is the deliverable; do not fake success.)

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/api-key.schema.ts src/db/schema/index.ts drizzle/
git commit -m "feat(db): add api_keys table"
```

---

### Task 2: Key generation & hashing utility

**Files:**
- Create: `src/utils/api-key.ts`
- Test: `src/utils/api-key.test.ts`

**Interfaces:**
- Produces:
  - `hashKey(secret: string): string` — SHA-256 hex (64 chars).
  - `generateKey(): { secret: string; prefix: string; hash: string }` — `secret` = `tte_<base64url32>`, `prefix` = `tte_` + first 6 body chars, `hash` = `hashKey(secret)`.

- [ ] **Step 1: Write the failing test**

`src/utils/api-key.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKey, hashKey } from './api-key.js';

test('hashKey is deterministic 64-char hex', () => {
  const h1 = hashKey('tte_abc');
  const h2 = hashKey('tte_abc');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('generateKey returns tte_-prefixed secret whose hash matches', () => {
  const { secret, prefix, hash } = generateKey();
  assert.match(secret, /^tte_[A-Za-z0-9_-]+$/);
  assert.equal(prefix, secret.slice(0, 10)); // 'tte_' + 6 chars
  assert.equal(hash, hashKey(secret));
  assert.notEqual(hash, secret);
});

test('generateKey produces distinct secrets', () => {
  assert.notEqual(generateKey().secret, generateKey().secret);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `./api-key.js`.

- [ ] **Step 3: Write minimal implementation**

`src/utils/api-key.ts`:

```ts
import { randomBytes, createHash } from 'node:crypto';

const PREFIX = 'tte_';

export function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateKey(): { secret: string; prefix: string; hash: string } {
  const body = randomBytes(32).toString('base64url');
  const secret = `${PREFIX}${body}`;
  const prefix = `${PREFIX}${body.slice(0, 6)}`;
  return { secret, prefix, hash: hashKey(secret) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (the three new tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/api-key.ts src/utils/api-key.test.ts
git commit -m "feat(utils): api key generation and hashing"
```

---

### Task 3: Scope model + `requireScope` guard

**Files:**
- Create: `src/middlewares/scopes.ts`
- Test: `src/middlewares/scopes.test.ts`

**Interfaces:**
- Consumes: `c.get('apiKey').scopes` (set later by `apiKeyAuth`).
- Produces:
  - `KNOWN_SCOPES: readonly string[]` = `['eseal:read','eseal:write','docsummary:read','docsummary:write']`.
  - `scopeSatisfies(granted: string[], required: string): boolean`.
  - `isValidScopeGrant(scope: string): boolean` — accepts a known exact scope, `<knownResource>:*`, or `*`.
  - `requireScope(required: string): MiddlewareHandler` — 403 `{ error: 'Forbidden', missingScope }` when unsatisfied.

- [ ] **Step 1: Write the failing test**

`src/middlewares/scopes.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  scopeSatisfies,
  isValidScopeGrant,
  requireScope,
} from './scopes.js';
import type { ApiKeyContext } from '../modules/api-key/service.js';

test('scopeSatisfies: exact, resource wildcard, global wildcard', () => {
  assert.equal(scopeSatisfies(['eseal:write'], 'eseal:write'), true);
  assert.equal(scopeSatisfies(['eseal:*'], 'eseal:write'), true);
  assert.equal(scopeSatisfies(['*'], 'eseal:write'), true);
  assert.equal(scopeSatisfies(['eseal:read'], 'eseal:write'), false);
  assert.equal(scopeSatisfies(['docsummary:*'], 'eseal:write'), false);
  assert.equal(scopeSatisfies([], 'eseal:write'), false);
});

test('isValidScopeGrant: known scopes and wildcards only', () => {
  assert.equal(isValidScopeGrant('eseal:read'), true);
  assert.equal(isValidScopeGrant('eseal:*'), true);
  assert.equal(isValidScopeGrant('*'), true);
  assert.equal(isValidScopeGrant('eseal:delete'), false);
  assert.equal(isValidScopeGrant('unknown:*'), false);
  assert.equal(isValidScopeGrant('garbage'), false);
});

test('requireScope: 403 when missing, next when satisfied', async () => {
  const app = new Hono<{ Variables: { apiKey: ApiKeyContext } }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', { id: 'k', name: 'n', scopes: ['eseal:read'] });
    await next();
  });
  app.get('/w', requireScope('eseal:write'), (c) => c.text('ok'));
  app.get('/r', requireScope('eseal:read'), (c) => c.text('ok'));

  assert.equal((await app.request('/w')).status, 403);
  assert.equal((await app.request('/r')).status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `./scopes.js`.

- [ ] **Step 3: Write minimal implementation**

`src/middlewares/scopes.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import type { ApiKeyContext } from '../modules/api-key/service.js';

export const KNOWN_SCOPES = [
  'eseal:read',
  'eseal:write',
  'docsummary:read',
  'docsummary:write',
] as const;

const KNOWN_RESOURCES = ['eseal', 'docsummary'];

export function scopeSatisfies(granted: string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  const resource = required.split(':')[0];
  return granted.includes(`${resource}:*`);
}

export function isValidScopeGrant(scope: string): boolean {
  if (scope === '*') return true;
  if ((KNOWN_SCOPES as readonly string[]).includes(scope)) return true;
  const m = /^([a-z]+):\*$/.exec(scope);
  return m !== null && KNOWN_RESOURCES.includes(m[1]);
}

export function requireScope(required: string): MiddlewareHandler<{
  Variables: { apiKey: ApiKeyContext };
}> {
  return async (c, next) => {
    const { scopes } = c.get('apiKey');
    if (!scopeSatisfies(scopes, required)) {
      return c.json({ error: 'Forbidden', missingScope: required }, 403);
    }
    await next();
  };
}
```

Note: this file imports the `ApiKeyContext` **type** from Task 4's service. Types are erased at runtime, so ordering only matters for the type-check; define the service in Task 4 before running `pnpm build`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middlewares/scopes.ts src/middlewares/scopes.test.ts
git commit -m "feat(mw): scope matching and requireScope guard"
```

---

### Task 4: api-key Zod schemas + service

**Files:**
- Create: `src/modules/api-key/schema.ts`
- Create: `src/modules/api-key/service.ts`
- Test: `src/modules/api-key/service.test.ts` (pure `isApiKeyValid` + schema validation only; DB functions are not unit-tested, matching repo convention)

**Interfaces:**
- Consumes: `apiKeys` (Task 1), `generateKey`/`hashKey` (Task 2), `isValidScopeGrant` (Task 3), `db` from `src/utils/db.ts`.
- Produces:
  - `ApiKeyContext = { id: string; name: string; scopes: string[] }`.
  - `PublicApiKey` = `{ id; name; prefix; scopes; status: 'active'|'revoked'|'expired'; expiresAt; lastUsedAt; createdAt; updatedAt }`.
  - `isApiKeyValid(row: { revokedAt: Date|null; expiresAt: Date|null }, now?: Date): boolean`.
  - `createKey(input: { name: string; scopes: string[]; expiresAt: Date|null }): Promise<PublicApiKey & { secret: string }>`.
  - `verifyKey(token: string): Promise<ApiKeyContext | null>`.
  - `listKeys(): Promise<PublicApiKey[]>`; `getKey(id): Promise<PublicApiKey|null>`; `revokeKey(id): Promise<PublicApiKey|null>`; `updateKey(id, patch: { name?: string; scopes?: string[] }): Promise<PublicApiKey|null>`.
  - `CreateKeySchema`, `UpdateKeySchema` (Zod) exporting `{ name, scopes, expiresAt }`.

- [ ] **Step 1: Write the failing test**

`src/modules/api-key/service.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isApiKeyValid } from './service.js';
import { CreateKeySchema } from './schema.js';

const now = new Date('2026-09-21T00:00:00Z');

test('isApiKeyValid: active when not revoked and not expired', () => {
  assert.equal(isApiKeyValid({ revokedAt: null, expiresAt: null }, now), true);
  assert.equal(
    isApiKeyValid(
      { revokedAt: null, expiresAt: new Date('2999-01-01T00:00:00Z') },
      now,
    ),
    true,
  );
});

test('isApiKeyValid: false when revoked', () => {
  assert.equal(isApiKeyValid({ revokedAt: now, expiresAt: null }, now), false);
});

test('isApiKeyValid: false when expired (<= now)', () => {
  assert.equal(
    isApiKeyValid(
      { revokedAt: null, expiresAt: new Date('2020-01-01T00:00:00Z') },
      now,
    ),
    false,
  );
});

test('CreateKeySchema: rejects unknown scope, accepts wildcard, nulls missing expiry', () => {
  assert.equal(
    CreateKeySchema.safeParse({ name: 'x', scopes: ['eseal:delete'] }).success,
    false,
  );
  const ok = CreateKeySchema.safeParse({ name: 'x', scopes: ['eseal:*'] });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.expiresAt, null);
});

test('CreateKeySchema: parses ISO expiresAt to Date', () => {
  const r = CreateKeySchema.safeParse({
    name: 'x',
    scopes: ['eseal:read'],
    expiresAt: '2027-01-01T00:00:00Z',
  });
  assert.equal(r.success, true);
  if (r.success) assert.ok(r.data.expiresAt instanceof Date);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find `./service.js` / `./schema.js`.

- [ ] **Step 3: Write minimal implementation**

`src/modules/api-key/schema.ts`:

```ts
import { z } from 'zod';
import { isValidScopeGrant } from '../../middlewares/scopes.js';

const scopes = z
  .array(z.string())
  .min(1)
  .refine((arr) => arr.every(isValidScopeGrant), {
    message: 'contains an unknown scope',
  });

export const CreateKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes,
  expiresAt: z.iso
    .datetime()
    .nullish()
    .transform((v) => (v ? new Date(v) : null)),
});

export const UpdateKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: scopes.optional(),
});

export type CreateKeyInput = z.infer<typeof CreateKeySchema>;
export type UpdateKeyInput = z.infer<typeof UpdateKeySchema>;
```

`src/modules/api-key/service.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../../utils/db.js';
import { apiKeys } from '../../db/schema/index.js';
import { generateKey, hashKey } from '../../utils/api-key.js';
import type { CreateKeyInput, UpdateKeyInput } from './schema.js';

export type ApiKeyContext = { id: string; name: string; scopes: string[] };

type Row = typeof apiKeys.$inferSelect;

export type PublicApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function isApiKeyValid(
  row: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

function status(row: Row, now = new Date()): PublicApiKey['status'] {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime())
    return 'expired';
  return 'active';
}

function toPublic(row: Row): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    status: status(row),
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createKey(
  input: CreateKeyInput,
): Promise<PublicApiKey & { secret: string }> {
  const { secret, prefix, hash } = generateKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: input.name,
      keyHash: hash,
      prefix,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    })
    .returning();
  return { ...toPublic(row), secret };
}

export async function verifyKey(token: string): Promise<ApiKeyContext | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashKey(token)))
    .limit(1);
  if (!row || !isApiKeyValid(row)) return null;
  // Best-effort last-used tracking; never blocks or fails the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});
  return { id: row.id, name: row.name, scopes: row.scopes };
}

export async function listKeys(): Promise<PublicApiKey[]> {
  const rows = await db.select().from(apiKeys);
  return rows.map(toPublic);
}

export async function getKey(id: string): Promise<PublicApiKey | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);
  return row ? toPublic(row) : null;
}

export async function revokeKey(id: string): Promise<PublicApiKey | null> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id))
    .returning();
  return row ? toPublic(row) : null;
}

export async function updateKey(
  id: string,
  patch: UpdateKeyInput,
): Promise<PublicApiKey | null> {
  const [row] = await db
    .update(apiKeys)
    .set(patch)
    .where(eq(apiKeys.id, id))
    .returning();
  return row ? toPublic(row) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (five new tests). If `z.iso.datetime()` errors on the installed Zod, use `z.string().datetime()` instead — same behavior.

- [ ] **Step 5: Commit**

```bash
git add src/modules/api-key/schema.ts src/modules/api-key/service.ts src/modules/api-key/service.test.ts
git commit -m "feat(api-key): validation schema and service"
```

---

### Task 5: `apiKeyAuth` + `adminAuth` middleware

**Files:**
- Create: `src/middlewares/api-key-auth.ts`
- Create: `src/middlewares/admin-auth.ts`
- Test: `src/middlewares/api-key-auth.test.ts`

**Interfaces:**
- Consumes: `verifyKey`, `ApiKeyContext` (Task 4).
- Produces:
  - `apiKeyAuth(deps?: { verifyKey?: (token: string) => Promise<ApiKeyContext | null> }): MiddlewareHandler` — 401 on missing/invalid; else `c.set('apiKey', ctx)`.
  - `adminAuth(): MiddlewareHandler` — compares Bearer to `process.env.ADMIN_API_KEY` constant-time; 401 on missing env, missing token, or mismatch.

- [ ] **Step 1: Write the failing test**

`src/middlewares/api-key-auth.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { apiKeyAuth } from './api-key-auth.js';
import { adminAuth } from './admin-auth.js';
import { requireScope } from './scopes.js';
import type { ApiKeyContext } from '../modules/api-key/service.js';

function appWithAuth(verifyKey: (t: string) => Promise<ApiKeyContext | null>) {
  const app = new Hono<{ Variables: { apiKey: ApiKeyContext } }>();
  app.use('/api/*', apiKeyAuth({ verifyKey }));
  app.get('/api/write', requireScope('eseal:write'), (c) => c.text('ok'));
  app.get('/api/read', requireScope('eseal:read'), (c) => c.text('ok'));
  return app;
}

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

test('apiKeyAuth: no key -> 401', async () => {
  const app = appWithAuth(async () => null);
  assert.equal((await app.request('/api/read')).status, 401);
});

test('apiKeyAuth: invalid key -> 401', async () => {
  const app = appWithAuth(async () => null);
  assert.equal((await app.request('/api/read', bearer('bad'))).status, 401);
});

test('apiKeyAuth + requireScope: valid key wrong scope -> 403', async () => {
  const app = appWithAuth(async () => ({
    id: 'k',
    name: 'n',
    scopes: ['eseal:read'],
  }));
  assert.equal((await app.request('/api/write', bearer('good'))).status, 403);
});

test('apiKeyAuth + requireScope: valid key right scope -> 200', async () => {
  const app = appWithAuth(async () => ({
    id: 'k',
    name: 'n',
    scopes: ['eseal:write'],
  }));
  assert.equal((await app.request('/api/write', bearer('good'))).status, 200);
});

test('adminAuth: missing env or token -> 401, correct -> 200', async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'secret-admin';
  const app = new Hono();
  app.use('/admin/*', adminAuth());
  app.get('/admin/ping', (c) => c.text('ok'));

  assert.equal((await app.request('/admin/ping')).status, 401);
  assert.equal(
    (await app.request('/admin/ping', bearer('wrong'))).status,
    401,
  );
  assert.equal(
    (await app.request('/admin/ping', bearer('secret-admin'))).status,
    200,
  );

  process.env.ADMIN_API_KEY = prev;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find `./api-key-auth.js` / `./admin-auth.js`.

- [ ] **Step 3: Write minimal implementation**

`src/middlewares/api-key-auth.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import {
  verifyKey as defaultVerifyKey,
  type ApiKeyContext,
} from '../modules/api-key/service.js';

export function apiKeyAuth(
  deps: {
    verifyKey?: (token: string) => Promise<ApiKeyContext | null>;
  } = {},
): MiddlewareHandler<{ Variables: { apiKey: ApiKeyContext } }> {
  const verify = deps.verifyKey ?? defaultVerifyKey;
  return async (c, next) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    const ctx = await verify(token);
    if (!ctx) return c.json({ error: 'Unauthorized' }, 401);
    c.set('apiKey', ctx);
    await next();
  };
}
```

`src/middlewares/admin-auth.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';

export function adminAuth(): MiddlewareHandler {
  return async (c, next) => {
    const expected = process.env.ADMIN_API_KEY;
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!expected || !token) return c.json({ error: 'Unauthorized' }, 401);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (five new tests).

- [ ] **Step 5: Commit**

```bash
git add src/middlewares/api-key-auth.ts src/middlewares/admin-auth.ts src/middlewares/api-key-auth.test.ts
git commit -m "feat(mw): apiKeyAuth and adminAuth"
```

---

### Task 6: Admin key management router

**Files:**
- Create: `src/modules/api-key/router.ts`

**Interfaces:**
- Consumes: `createKey`, `listKeys`, `getKey`, `updateKey`, `revokeKey` (Task 4), `CreateKeySchema`, `UpdateKeySchema` (Task 4).
- Produces: `apiKeyRoute` (Hono sub-app) mounted later at `/admin/keys`. Carries no auth itself; `adminAuth` is applied in `app.ts`.

- [ ] **Step 1: Write the router**

`src/modules/api-key/router.ts`:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateKeySchema, UpdateKeySchema } from './schema.js';
import {
  createKey,
  getKey,
  listKeys,
  revokeKey,
  updateKey,
} from './service.js';

export const apiKeyRoute = new Hono()
  .post('/', zValidator('json', CreateKeySchema), async (c) => {
    const data = await createKey(c.req.valid('json'));
    return c.json({ data }, 201);
  })
  .get('/', async (c) => c.json({ data: await listKeys() }))
  .get('/:id', async (c) => {
    const key = await getKey(c.req.param('id'));
    if (!key) return c.json({ error: 'Key not found' }, 404);
    return c.json({ data: key });
  })
  .patch('/:id', zValidator('json', UpdateKeySchema), async (c) => {
    const key = await updateKey(c.req.param('id'), c.req.valid('json'));
    if (!key) return c.json({ error: 'Key not found' }, 404);
    return c.json({ data: key });
  })
  .post('/:id/revoke', async (c) => {
    const key = await revokeKey(c.req.param('id'));
    if (!key) return c.json({ error: 'Key not found' }, 404);
    return c.json({ data: key });
  });
```

- [ ] **Step 2: Type-check compiles**

Run: `pnpm build`
Expected: no type errors (routes wired in Task 8; this only checks the module compiles). If the build config excludes unreferenced files, this is confirmed in Task 8 instead — acceptable.

- [ ] **Step 3: Commit**

```bash
git add src/modules/api-key/router.ts
git commit -m "feat(api-key): admin CRUD router"
```

---

### Task 7: Add `requireScope` guards to protected modules

**Files:**
- Modify: `src/modules/e-seal/router.ts`
- Modify: `src/modules/doc-summary/router.ts`

**Interfaces:**
- Consumes: `requireScope` (Task 3).
- Produces: unchanged route exports (`esealRoute`, `docSummaryRoute`), now scope-guarded.

- [ ] **Step 1: Guard e-seal routes**

Modify `src/modules/e-seal/router.ts`. Add the import and insert `requireScope(...)` as the first handler on each route:

```ts
import { requireScope } from '../../middlewares/scopes.js';
```

- `POST /` → `requireScope('eseal:write')` before `zValidator('form', ...)`.
- `GET /`, `GET /:id`, `GET /:id/files`, `GET /:id/files/:fileId/:kind{raw|verified}` → `requireScope('eseal:read')` as first handler.

Example for the POST and one GET:

```ts
export const esealRoute = new Hono()
  .post(
    '/',
    requireScope('eseal:write'),
    zValidator('form', CreateEsealSchema),
    async (c) => {
      const batch = await createBatch(c.req.valid('form'));
      return c.json({ data: batch }, 202);
    },
  )
  .get('/', requireScope('eseal:read'), async (c) =>
    c.json({ data: await listBatches() }),
  )
  // ...apply requireScope('eseal:read') to the remaining GET routes
```

- [ ] **Step 2: Guard doc-summary routes**

Modify `src/modules/doc-summary/router.ts`:

```ts
import { requireScope } from '../../middlewares/scopes.js';
```

- `POST /` → `requireScope('docsummary:write')` before `zValidator('json', ...)`.
- `GET /`, `GET /:id` → `requireScope('docsummary:read')` as first handler.

- [ ] **Step 3: Type-check**

Run: `pnpm build`
Expected: the guarded routers compile. `requireScope`'s `Variables` type is compatible because `app.ts` (Task 8) types the app with `{ apiKey: ApiKeyContext }`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/e-seal/router.ts src/modules/doc-summary/router.ts
git commit -m "feat: scope-guard e-seal and doc-summary routes"
```

---

### Task 8: Rewire `app.ts`, env, remove Unkey; integration test

**Files:**
- Modify: `src/app.ts`
- Modify: `.env`, `.env.example`
- Modify: `package.json` (remove `@unkey/hono` via pnpm)
- Test: `src/app.test.ts`

**Interfaces:**
- Consumes: `apiKeyAuth` (Task 5), `adminAuth` (Task 5), `apiKeyRoute` (Task 6), `ApiKeyContext` (Task 4).
- Produces: final wired `app`; `AppType` unchanged in shape.

- [ ] **Step 1: Write the failing integration test**

`src/app.test.ts` (only DB-free paths — no valid-key case, which needs a DB):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './app.js';

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

test('health is public', async () => {
  assert.equal((await app.request('/health')).status, 200);
});

test('api routes require a key', async () => {
  assert.equal((await app.request('/api/v1/e-seal')).status, 401);
  assert.equal((await app.request('/api/v1/doc-summary')).status, 401);
});

test('admin routes require the admin key', async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'admin-secret';
  assert.equal((await app.request('/admin/keys')).status, 401);
  assert.equal(
    (await app.request('/admin/keys', bearer('nope'))).status,
    401,
  );
  process.env.ADMIN_API_KEY = prev;
});

test('docs and openapi are behind the admin key', async () => {
  assert.equal((await app.request('/openapi.json')).status, 401);
  assert.equal((await app.request('/docs')).status, 401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — current `app.ts` still uses Unkey; `/admin/keys` 404, `/api/v1/*` not 401 as asserted, etc.

- [ ] **Step 3: Rewire `app.ts`**

Replace `src/app.ts` with:

```ts
import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';

import { openApiDocument } from './openapi.js';
import { docSummaryRoute } from './modules/doc-summary/router.js';
import { esealRoute } from './modules/e-seal/router.js';
import { apiKeyRoute } from './modules/api-key/router.js';
import { apiKeyAuth } from './middlewares/api-key-auth.js';
import { adminAuth } from './middlewares/admin-auth.js';
import type { ApiKeyContext } from './modules/api-key/service.js';

if (!process.env.ADMIN_API_KEY) {
  console.warn(
    '⚠️  ADMIN_API_KEY is not set — admin routes and docs will reject all requests.',
  );
}

export const app = new Hono<{ Variables: { apiKey: ApiKeyContext } }>();

// Public liveness probe.
app.get('/health', (c) => c.json({ status: '🔥 Hono is running!' }));

// Docs + admin key management: behind the admin key.
app.use('/openapi.json', adminAuth());
app.use('/docs', adminAuth());
app.use('/admin/*', adminAuth());

app.get('/openapi.json', (c) => c.json(openApiDocument));
app.get('/docs', Scalar({ url: '/openapi.json', pageTitle: 'TTE API Reference' }));
app.route('/admin/keys', apiKeyRoute);

// Business API: behind an API key; per-route scope guards live in the routers.
app.use('/api/v1/*', apiKeyAuth());

const api = app
  .basePath('/api/v1')
  .route('/doc-summary', docSummaryRoute)
  .route('/e-seal', esealRoute);

export type AppType = typeof api;
```

- [ ] **Step 4: Update env files**

- `.env`: remove the `UNKEY_ROOT_KEY=` line, add `ADMIN_API_KEY=` (set a real secret locally for manual testing).
- `.env.example`: remove `UNKEY_ROOT_KEY=`, add `ADMIN_API_KEY=`.

- [ ] **Step 5: Remove the Unkey dependency**

Run: `pnpm remove @unkey/hono`
Expected: `@unkey/hono` gone from `package.json` dependencies.

- [ ] **Step 6: Run tests + type-check**

Run: `pnpm test && pnpm build`
Expected: all tests PASS; build has no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/app.test.ts .env.example package.json pnpm-lock.yaml
git commit -m "feat: wire api-key auth into app, drop unkey"
```

(`.env` is gitignored — do not commit it.)

---

### Task 9: End-to-end smoke test (manual, requires dev DB)

**Files:** none (throwaway verification).

- [ ] **Step 1: Start the server**

Set `ADMIN_API_KEY=admin-secret` in `.env`, ensure `DATABASE_URL` points at a migrated DB, then run `pnpm dev`.

- [ ] **Step 2: Verify the access map with curl**

```bash
# public
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health            # 200
# api without key
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/e-seal      # 401
# admin without key
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/admin/keys         # 401
# create a key
curl -s -X POST localhost:3000/admin/keys \
  -H 'Authorization: Bearer admin-secret' -H 'Content-Type: application/json' \
  -d '{"name":"client-a","scopes":["eseal:read"]}'                          # 201 + { data: { secret } }
# use the returned secret
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/e-seal \
  -H 'Authorization: Bearer <secret>'                                       # 200
# wrong scope
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/v1/e-seal \
  -H 'Authorization: Bearer <secret>'                                       # 403
# revoke, then reuse
curl -s -X POST localhost:3000/admin/keys/<id>/revoke -H 'Authorization: Bearer admin-secret'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/e-seal \
  -H 'Authorization: Bearer <secret>'                                       # 401
```

- [ ] **Step 2 (fallback, no dev DB):** run the same request matrix via a throwaway `app.request` script with a stubbed `verifyKey` — but the DB-free assertions are already covered by `src/app.test.ts` and the middleware tests, so this step is only to confirm the real DB path end-to-end. Report explicitly if no dev DB was available.

- [ ] **Step 3: Report findings** (no commit).

---

## Self-Review

**Spec coverage:**
- §4 schema → Task 1. §5 key format/hashing → Task 2. §6 scopes → Task 3. §7 middleware → Tasks 3 (`requireScope`) + 5 (`apiKeyAuth`, `adminAuth`). §8 module (schema/service/router) → Tasks 4 + 6. §9 wiring → Task 8. §10 env/migration → Tasks 1 + 8. §11 testing → Tasks 2–5, 8. §12 security (hash-only, constant-time, fail-closed, immediate revoke, best-effort last_used) → Tasks 2, 4, 5, 8. §13 rollout → Tasks 1→8 order + Task 8 step 5. No gaps.

**Placeholder scan:** every code step contains full source; no TBD/TODO. The only "fill in the rest" is Task 7's repeated GET guards, which are fully specified by pattern + example (the exact route strings are listed).

**Type consistency:** `ApiKeyContext = { id, name, scopes }` defined in Task 4, consumed identically in Tasks 3, 5, 8. `verifyKey(token) => Promise<ApiKeyContext|null>` consistent between Task 4 (def), Task 5 (default + injected), Task 8 (test stub). `PublicApiKey` used by service functions returned to Task 6 router. Scope helper names (`scopeSatisfies`, `isValidScopeGrant`, `requireScope`, `KNOWN_SCOPES`) consistent across Tasks 3, 4, 5, 7.
