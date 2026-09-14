import { Worker } from 'bullmq';

import { QUEUE_NAME, workerConnection } from './config.js';
import {
  completeJob,
  markJobFailed,
  markJobProcessing,
  summarizeDocument,
} from '../modules/job/service.js';
import type { DocSummaryJobPayload } from '../modules/job/schema.js';

export const worker = new Worker<DocSummaryJobPayload>(
  QUEUE_NAME,
  async (job) => {
    const { jobId, content } = job.data;

    if (!jobId) {
      throw new Error('Job ID is missing');
    }

    console.log(`Processing doc summary job: ${jobId}`);
    await markJobProcessing(jobId);

    try {
      const summary = await summarizeDocument(content);

      await completeJob(jobId, {
        title: summary.title,
        summary: summary.summary,
        content,
      });

      console.log(`Doc summary job ${jobId} completed`);
    } catch (error) {
      await markJobFailed(
        jobId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  },
  {
    connection: workerConnection,
    concurrency: 5,
  },
);

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id} failed`, error);
});
