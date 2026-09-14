import { Queue } from 'bullmq';

import { QUEUE_NAME, workerConnection } from './config.js';
import type { DocSummaryJobPayload } from '../modules/job/schema.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1_000,
  },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export const queue = new Queue<DocSummaryJobPayload>(QUEUE_NAME, {
  connection: workerConnection,
  defaultJobOptions,
});

// export const tteQueue = new Queue<TteJob>(TTE_QUEUE_NAME, {
//   connection: workerConnection,
//   defaultJobOptions,
// });
