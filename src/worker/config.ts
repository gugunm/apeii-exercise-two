import 'dotenv/config';
import type { ConnectionOptions } from 'bullmq';

// queue name collection
export const QUEUE_NAME = 'ai-doc-summarize-queue';
// export const TTE_QUEUE_NAME = 'tte';

// this is redis connection
export const workerConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
};
