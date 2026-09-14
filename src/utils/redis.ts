import { Redis } from 'ioredis';
export const connection = new Redis(
  process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  {
    maxRetriesPerRequest: null, // recommended for BullMQ + ioredis in some setups
    enableReadyCheck: false,
  },
);
