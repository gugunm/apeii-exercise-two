import { Queue } from 'bullmq';

import { connection } from '../utils/redis.js';
import type { DocSummaryJobPayload } from '../modules/job/schema.js';

export const DOC_SUMMARY_QUEUE_NAME = 'ai-doc-summarize-queue';

export const docSummarizeQueue = new Queue<DocSummaryJobPayload>(
  DOC_SUMMARY_QUEUE_NAME,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  },
);
