// src/worker.ts
import { Worker } from 'bullmq';

import { redisConnection } from './lib/queue.js';
import type { TteJob } from './modules/tte/schema.js';

const worker = new Worker<TteJob>(
  'tte',
  async (job) => {
    console.log(`Processing TTE ${job.data.tteId}`);
    // Do the background work here.

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id} failed`, error);
});
