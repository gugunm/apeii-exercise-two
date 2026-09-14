// src/worker.ts — worker entrypoint (`pnpm worker`).
import { Worker } from 'bullmq';

import { TTE_QUEUE_NAME, workerConnection } from './worker/config.js';
import type { TteJob } from './modules/tte/schema.js';

// doc-summary worker registers itself on import
import './worker/worker.js';

const tteWorker = new Worker<TteJob>(
  TTE_QUEUE_NAME,
  async (job) => {
    console.log(`Processing TTE ${job.data.tteId}`);
    // Do the background work here.

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  },
  {
    connection: workerConnection,
    concurrency: 5,
  },
);

tteWorker.on('failed', (job, error) => {
  console.error(`TTE job ${job?.id} failed`, error);
});
