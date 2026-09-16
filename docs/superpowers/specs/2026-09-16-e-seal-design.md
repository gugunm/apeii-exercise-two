# E-Seal Design

Date: 2026-09-16
Status: Approved for implementation planning

Replaces the draft in `plans/e-seal.md`. Where this document and the draft
disagree, this document wins.

## 1. Summary

Users upload one or more PDF files in a single request. The API stores the
raw files in S3, records one **batch** in PostgreSQL, and enqueues one BullMQ
job. A worker downloads the files, sends them to BSrE in **one** `seal/pdf`
call (BSrE accepts a `file[]` array), uploads the sealed PDFs back to S3, and
marks the batch completed. Every step is written to a per-batch log table.
Clients poll `GET /api/v1/e-seal/:id` until the batch reaches a terminal
status.

```text
1 request = 1 batch = 1 BullMQ job = 1 BSrE call
```

### Not in scope

- Authentication or a `users` table (`userId` is taken from the request body as-is)
- Deleting raw files after sealing
- Webhooks, SSE, or WebSocket status push
- Batching files across requests
- BSrE rate limiting
- Per-file status or partial success (BSrE call is all-or-nothing)

## 2. Conventions

Follow the existing `doc-summary` module:

- IDs: `char(26)` ULID via `$defaultFn(() => ulid())`
- Status columns: Drizzle `pgEnum`, not `varchar` + `CHECK`
- Timestamps: `created_at`, `updated_at` (with `$onUpdate`), `started_at`, `finished_at`, all `timestamptz`
- Routes mounted under `/api/v1`, chained on `app` in `src/app.ts` so `AppType` stays typed
- Queue payload carries identifiers only, never file content
- Worker imported from `src/worker.ts`

## 3. Database schema

File: `src/db/schema/e-seal.schema.ts` (replaces the current placeholder
table). Export from `src/db/schema/index.ts`.

### Enums

```text
eseal_batch_status: PENDING | PROCESSING | COMPLETED | FAILED
eseal_batch_step:   QUEUED | DOWNLOADING | SEALING | UPLOADING | COMPLETED | FAILED
eseal_log_level:    INFO | ERROR
```

### `eseal_batches`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | char(26) | ULID, PK. Also the S3 root prefix. |
| `user_id` | varchar(255) | From request body. No FK. |
| `status` | eseal_batch_status | default `PENDING` |
| `current_step` | eseal_batch_step | default `QUEUED` |
| `seal_config` | jsonb, not null | See §4 for shape |
| `error` | text | Last error message, kept across retries |
| `started_at` | timestamptz | Set on first `PROCESSING` |
| `finished_at` | timestamptz | Set on `COMPLETED` or `FAILED` |
| `created_at` | timestamptz | default now |
| `updated_at` | timestamptz | default now, `$onUpdate` |

Index: `(status, created_at)`.

### `eseal_files`

One row per uploaded file. Carries metadata and S3 keys only; no status.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | char(26) | ULID, PK |
| `batch_id` | char(26) | FK `eseal_batches.id`, `ON DELETE CASCADE` |
| `position` | smallint | 0-based order in the request; used to map BSrE response |
| `original_filename` | varchar(255) | As uploaded |
| `file_size` | bigint | Bytes |
| `raw_path` | text | `{batchId}/raw/{position}.pdf` |
| `verified_path` | text, nullable | `{batchId}/verified/{position}.pdf` after sealing |
| `created_at` | timestamptz | |

Index: `(batch_id, position)`.

### `eseal_logs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | char(26) | ULID, PK |
| `batch_id` | char(26) | FK `eseal_batches.id`, `ON DELETE CASCADE` |
| `level` | eseal_log_level | |
| `step` | eseal_batch_step | Step active when the log was written |
| `message` | text | Human-readable, no secrets, no base64 |
| `meta` | jsonb, nullable | Small structured extras, e.g. `{ "attempt": 2, "willRetry": true }` |
| `created_at` | timestamptz | |

Index: `(batch_id, created_at)`.

### `bsre_totp`

Single-row table holding the currently valid BSrE TOTP.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | smallint | PK, always `1` |
| `totp` | varchar(10) | |
| `expires_at` | timestamptz | From BSrE `expires` |
| `updated_at` | timestamptz | |

The first row is seeded manually (via SQL or `pnpm db:studio`) with a TOTP
obtained out-of-band from BSrE. The worker refreshes it afterwards (§6.3).

### Relations

`eseal_batches` 1:N `eseal_files`, 1:N `eseal_logs`, declared with
`defineRelations` like `docSummaryRelations`.

## 4. API

Module: `src/modules/e-seal/{schema,service,router}.ts`. Mounted at
`/api/v1/e-seal`.

### `POST /api/v1/e-seal`

`multipart/form-data`:

| Field | Required | Rules |
| --- | --- | --- |
| `files[]` | yes | 1..`ESEAL_MAX_FILES` files, each `application/pdf`, each ≤ `ESEAL_MAX_FILE_BYTES` |
| `userId` | yes | non-empty string |
| `tampilan` | yes | `INVISIBLE` or `VISIBLE` |
| `page` | if VISIBLE | integer ≥ 1 |
| `originX`, `originY`, `width`, `height` | if VISIBLE | number |
| `location` | if VISIBLE | string |
| `reason` | no | string, default `"null"` |

Validation uses a zod `discriminatedUnion` on `tampilan`. For `INVISIBLE`,
positional fields are ignored. Invalid input returns `400` before any S3 or
DB write.

`seal_config` stored in the batch is the validated object minus `userId` and
files, e.g.

```json
{ "tampilan": "VISIBLE", "page": 1, "originX": 0, "originY": 0,
  "width": 150, "height": 50, "location": "Jakarta", "reason": "null" }
```

Processing order:

1. Validate body. On failure return `400`.
2. Generate `batchId` (ULID).
3. Upload every file to `{batchId}/raw/{position}.pdf` with `Promise.all`.
   On failure return `500`; no rows are written.
4. In one DB transaction insert `eseal_batches` and all `eseal_files`, and
   one `eseal_logs` row (`INFO`, `QUEUED`, "Batch created with N files").
5. `esealQueue.add('seal', { batchId }, { jobId: batchId })`. Using the
   batch id as the BullMQ job id makes enqueueing idempotent.
6. Return `202`:

```json
{ "data": { "id": "<batchId>", "status": "PENDING", "totalFiles": 3,
  "statusUrl": "/api/v1/e-seal/<batchId>" } }
```

### `GET /api/v1/e-seal/:id`

Returns `404` `{ "error": "Batch not found" }` if missing. Otherwise:

```json
{
  "data": {
    "id": "...", "userId": "...", "status": "PROCESSING", "currentStep": "SEALING",
    "sealConfig": { "tampilan": "INVISIBLE", "reason": "null" },
    "error": null,
    "startedAt": "...", "finishedAt": null, "createdAt": "...", "updatedAt": "...",
    "files": [
      { "id": "...", "filename": "Surat.pdf", "fileSize": 2483921, "downloadUrl": null }
    ],
    "logs": [
      { "level": "INFO", "step": "QUEUED", "message": "Batch created with 1 files", "meta": null, "createdAt": "..." }
    ]
  }
}
```

- `downloadUrl` is a presigned S3 GET for `verified_path`, TTL
  `ESEAL_SIGNED_URL_TTL` seconds, only when `status = COMPLETED`; otherwise
  `null`.
- `files` ordered by `position`; `logs` ordered by `created_at asc`.
- No numeric progress field. Clients map `currentStep` themselves.

### `GET /api/v1/e-seal`

Lists batches (no files, no logs) ordered by `created_at desc`. Same shape
as the doc-summary list endpoint.

### Client polling

Poll `GET /:id` every 2 s; stop when `status` is `COMPLETED` or `FAILED`.

## 5. Queue

File: `src/queues/e-seal.queue.ts`.

- Queue name: `eseal`
- Payload type: `{ batchId: string }`
- `defaultJobOptions`: `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`,
  `removeOnComplete: 1000`, `removeOnFail: 5000` (same as doc-summary)

## 6. Worker

File: `src/workers/e-seal.worker.ts`, imported from `src/worker.ts`.
`concurrency: 1` — one batch's base64 payload in memory at a time.

### 6.1 Happy path

1. Load batch, files (by `position`). If batch missing, throw.
2. Update batch: `status = PROCESSING`, `current_step = DOWNLOADING`,
   `started_at = COALESCE(started_at, now())`.
3. Download every `raw_path` from S3 into `Buffer[]`, convert each to base64.
   If `tampilan = VISIBLE`, also download `BSRE_SEAL_IMAGE_KEY` and base64 it.
   Log `INFO DOWNLOADING "Downloaded N files from S3"`.
4. Update `current_step = SEALING`. Obtain TOTP (§6.3). Call BSrE
   `sealPdf` (§7.2) with `seal_config`, `idSubscriber`, `totp`, `file[]`.
   Log `INFO SEALING "BSrE sealed N files"` with `meta: { time }` from the
   response.
5. Verify `response.file.length === files.length`; otherwise throw
   `BSrE returned X files, expected N`.
6. Update `current_step = UPLOADING`. Decode each base64 to `Buffer`, upload
   to `{batchId}/verified/{position}.pdf` with `Promise.all`, set each
   `verified_path`. Log `INFO UPLOADING "Uploaded N verified files"`.
7. Update `status = COMPLETED`, `current_step = COMPLETED`,
   `finished_at = now()`. Log `INFO COMPLETED "Batch completed"`.

### 6.2 Failure

Wrap steps 2–7 in try/catch. On error:

- `isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)`
- Log `ERROR <current step> <error.message>` with
  `meta: { attempt: job.attemptsMade + 1, willRetry: !isFinal }`.
- Not final: update `current_step = QUEUED`, `error = message`; `status`
  stays `PROCESSING`. Rethrow so BullMQ retries.
- Final: update `status = FAILED`, `current_step = FAILED`, `error = message`,
  `finished_at = now()`. Rethrow.

A retried job restarts from step 1; raw files remain in S3 so this is safe.

### 6.3 TOTP

`getTotp()` in the BSrE client:

1. Read `bsre_totp` where `id = 1`. If no row, throw
   `BSRE_TOTP_NOT_SEEDED`.
2. If `expires_at > now() + 60s`, return `totp`.
3. Otherwise call `refreshTotp(currentTotp)`, update the row with the new
   `totp` and `expires`, log `INFO SEALING "TOTP refreshed"` on the batch,
   return the new value.

With worker concurrency 1 there is no concurrent refresh.

## 7. External clients

### 7.1 S3 — `src/utils/s3.ts`

Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

Env: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
optional `S3_ENDPOINT`. When `S3_ENDPOINT` is set, the client uses it with
`forcePathStyle: true` (MinIO and other S3-compatible stores).

Functions:

- `putObject(key: string, body: Buffer, contentType: string): Promise<void>`
- `getObject(key: string): Promise<Buffer>`
- `presignGet(key: string, ttlSeconds: number): Promise<string>`

### 7.2 BSrE — `src/utils/bsre.ts`

Uses Node's built-in `fetch`. Basic auth header from `BSRE_USERNAME` /
`BSRE_PASSWORD`. Base URL `BSRE_BASE_URL`. Subscriber `BSRE_ID_SUBSCRIBER`.
Any non-2xx response throws with the response body text.

`refreshTotp(currentTotp: string)` → `POST /api/v2/seal/get/totp`

```json
{ "idSubscriber": "<BSRE_ID_SUBSCRIBER>", "totp": "<currentTotp>", "data": "1" }
```

Response: `{ "message": string, "totp": string, "expires": string, "result": boolean }`.
`result !== true` throws.

`sealPdf({ totp, sealConfig, files, imageBase64? })` → `POST /api/v2/seal/pdf`

INVISIBLE:

```json
{ "idSubscriber": "...", "totp": "...",
  "signatureProperties": [ { "tampilan": "INVISIBLE", "location": "null", "reason": "null", "contactInfo": "null" } ],
  "file": [ "<base64>", "..." ] }
```

VISIBLE:

```json
{ "idSubscriber": "...", "totp": "...",
  "signatureProperties": [ { "imageBase64": "<seal image>", "tampilan": "VISIBLE",
    "page": 1, "originX": 0.0, "originY": 0.0, "width": 150.0, "height": 50.0,
    "location": "Jakarta", "reason": "null" } ],
  "file": [ "<base64>", "..." ] }
```

Response: `{ "time": number, "file": string[] }` — sealed PDFs, base64, same
order as the request.

`getTotp()` as described in §6.3 lives here too, taking `db` as a
dependency so it is testable.

## 8. Logging helper

`logBatch(batchId, { level, step, message, meta? })` in
`src/modules/e-seal/service.ts` inserts one `eseal_logs` row. Called at every
transition listed in §6. Messages never include base64 payloads, TOTP
values, or credentials.

## 9. Configuration

Additions to `.env.example`:

```dotenv
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_ENDPOINT=

BSRE_BASE_URL=
BSRE_USERNAME=
BSRE_PASSWORD=
BSRE_ID_SUBSCRIBER=
BSRE_SEAL_IMAGE_KEY=

ESEAL_MAX_FILES=20
ESEAL_MAX_FILE_BYTES=10485760
ESEAL_SIGNED_URL_TTL=900
```

## 10. Files touched

```text
src/db/schema/e-seal.schema.ts     replace placeholder
src/db/schema/index.ts             export e-seal schema
src/modules/e-seal/schema.ts       zod schemas + payload type
src/modules/e-seal/service.ts      createBatch, findBatch, listBatches, mark*, logBatch, sealBatch
src/modules/e-seal/router.ts       POST /, GET /, GET /:id
src/queues/e-seal.queue.ts
src/workers/e-seal.worker.ts
src/utils/s3.ts
src/utils/bsre.ts
src/app.ts                         .route('/e-seal', esealRoute)
src/worker.ts                      import e-seal worker
src/openapi.ts                     e-seal paths
drizzle/<migration>                pnpm db:generate
.env.example
README.md                          replace pseudo-code section with usage
package.json                       deps + test script
```

## 11. Testing

The repo has no test runner. Use `node:test` via
`"test": "tsx --test src/**/*.test.ts"`; no new dev dependency.

Unit tests (external calls mocked):

- `schema.test.ts`: `VISIBLE` without coordinates is rejected; `INVISIBLE`
  with coordinates passes and drops them; more than `ESEAL_MAX_FILES` or a
  non-PDF file is rejected.
- `bsre.test.ts`: `getTotp()` returns the cached value when not expired;
  calls `refreshTotp` and updates the row when expired; throws when unseeded.
- `worker.test.ts`: response `file.length` mismatch throws; non-final failure
  leaves `status = PROCESSING` and `current_step = QUEUED`; final failure sets
  `FAILED`; log rows are written in order `DOWNLOADING → SEALING → UPLOADING → COMPLETED`
  on success.

Real S3 and BSrE integration is verified manually with `curl` per the
README.
