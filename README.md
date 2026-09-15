# TTE and E-Seal API

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
