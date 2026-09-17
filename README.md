# Doc Summarization

Hono API for asynchronously summarizing documents with PostgreSQL, Redis,
BullMQ, and an OpenAI-compatible model.

## Setup

Requirements: Node.js, pnpm, PostgreSQL, and Redis.

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
```

Configure these values in `.env`:

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
REDIS_URL="redis://127.0.0.1:6379"
OPENAI_API_KEY=
OPENAI_BASE_URL=
```

## Run

Run the API and worker in separate terminals:

```bash
pnpm dev
```

```bash
pnpm worker
```

The API runs at `http://localhost:3000`.

## API Documentation

- Scalar: <http://localhost:3000/docs>
- OpenAPI JSON: <http://localhost:3000/openapi.json>
- Health check: <http://localhost:3000/health>

## Document Summary API

Create a job:

```bash
curl -X POST http://localhost:3000/api/v1/doc-summary \
  -H 'Content-Type: application/json' \
  -d '{"content":"Text to summarize."}'
```

The request returns `202 Accepted` with a job whose initial status is
`PENDING`. The worker processes it asynchronously.

List jobs:

```bash
curl http://localhost:3000/api/v1/doc-summary
```

Get a job and its result using the returned ULID:

```bash
curl http://localhost:3000/api/v1/doc-summary/01ARZ3NDEKTSV4RRFFQ69G5FAV
```

Possible job statuses are `PENDING`, `PROCESSING`, `COMPLETED`, and `FAILED`.
The `result` field remains `null` until processing completes.

## Queue Interface

Open a read-only Bull Board interface:

```bash
pnpm dlx @bull-board/cli \
  -r redis://:<REDIS_PASS>@<REDIS_HOST>:<REDIS_PORT> \
  -p 3001 \
  --read-only \
  --no-open
```

# E-Seal

Upload one or more PDFs; the worker seals them all in one BSrE call and
stores the results in S3 under `{batchId}/verified/`.

## Setup

Fill the `S3_*`, `BSRE_*` and `ESEAL_*` values in `.env` (see
`.env.example`), then seed the BSrE activation TOTP once:

```bash
psql "$DATABASE_URL" -c "INSERT INTO bsre_totp (kind, totp, expires_at) VALUES ('ACTIVATION', '<totp>', '<expires>') ON CONFLICT (kind) DO UPDATE SET totp = EXCLUDED.totp, expires_at = EXCLUDED.expires_at;"
```

The worker refreshes the activation and seal TOTPs afterwards.

## Create a batch

```bash
curl -X POST http://localhost:3000/api/v1/e-seal \
  -F 'files[]=@doc-1.pdf' \
  -F 'files[]=@doc-2.pdf' \
  -F 'userId=u-123' \
  -F 'tampilan=INVISIBLE'
```

Visible seal:

```bash
curl -X POST http://localhost:3000/api/v1/e-seal \
  -F 'files[]=@doc-1.pdf' \
  -F 'userId=u-123' \
  -F 'tampilan=VISIBLE' \
  -F 'page=1' -F 'originX=0' -F 'originY=0' \
  -F 'width=150' -F 'height=50' \
  -F 'location=Jakarta'
```

Returns `202 Accepted` with `{ id, status: "PENDING", totalFiles, statusUrl }`.

## Poll status

```bash
curl http://localhost:3000/api/v1/e-seal/<batchId>
```

Poll every 2 s until `status` is `COMPLETED` or `FAILED`. `currentStep`
moves through `QUEUED → DOWNLOADING → SEALING → UPLOADING → COMPLETED`.
Each file's `downloadUrl` is a presigned S3 URL (valid `ESEAL_SIGNED_URL_TTL`
seconds), `null` until the batch is `COMPLETED`. `logs[]` lists every
transition and error.

## View or download a file

```bash
# view inline (raw upload / sealed result)
curl http://localhost:3000/api/v1/e-seal/<batchId>/files/<fileId>/raw
curl http://localhost:3000/api/v1/e-seal/<batchId>/files/<fileId>/verified

# force download
curl -OJ "http://localhost:3000/api/v1/e-seal/<batchId>/files/<fileId>/verified?download=1"
```

`fileId` comes from `files[].id` in the batch detail. `verified` returns
`404` until the batch is `COMPLETED`. The PDF is streamed through the API,
so the S3 endpoint does not need to be reachable from the client.

## Tests

```bash
pnpm test
```
