import { Queue } from 'bullmq';

import { connection } from '../utils/redis.js';
import type { EsealJobPayload } from '../modules/e-seal/schema.js';

export const ESEAL_QUEUE_NAME = 'eseal';

export const esealQueue = new Queue<EsealJobPayload>(ESEAL_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});
