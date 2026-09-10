# Running App

```bash
pnpm dev

pnpm worker
```

## Testing worker

```bash
curl http://localhost:3000/api/v1/tte/tte-001
```

## Open Interface for queue

```bash
pnpm dlx @bull-board/cli -r redis://:<REDIS_PASS>@<REDIS_HOST>:<REDIS_PORT> -p 3001 --read-only --no-open
```
