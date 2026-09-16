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

## Pseudo Code

1. user post multi file ke /e-seal/create

- opsi 1 : upload multi file ke S3 | opsi 2 : uploadnya ke _dalam 1 folder "raw" dedicated_
- opsi 1 : masukin info setiap filenya ke table eseal_jobs (filePath,filename,mimeType,userId) menjadi rows sejumlah filenya | opsi 2 : masukin info foldernya ke table eseal_jobs
- masukkin info detailnya ke _queue_ menjadi 1 queue saja
- return status 202
- status default queue adalah PENDING

2. sekarang tahapan masuk ke workernya bullmq

- ambil data dari redis queue untuk diprocess, ubah status jadi PROCESSING
- download multi file (dari 1 folder dedicated) dari S3 berdasarkan path pada data queue
- convert setiap multi filenya ke base64 sebelum diseal pakai endpoint bsre
- request post OTP seal ke endpoint {{baseURL}}/api/v2/seal/get/totp
- request INVISIBLE seal ke endpoint {{baseURL}}/api/v2/seal/pdf -> "tampilan": "INVISIBLE"
- request VISIBLE seal ke endpoint {{baseURL}}/api/v2/seal/pdf -> "tampilan": "VISIBLE" (kalibrasi lokasi penyimpanan barcodenya)
- ambil base64 dari response bsre, lalu convert ke pdf dan simpan pdfnya di folder "verified" S3
- ubah status ke COMPLETED atau FAILED

3. get by id

- ini gimana caranya untuk update otomatis saat user ada di page itu.
