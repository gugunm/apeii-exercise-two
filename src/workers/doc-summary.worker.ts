import { Worker } from 'bullmq';
import { connection } from '../utils/redis.js';
import {
  completeJob,
  markJobFailed,
  markJobProcessing,
  summarizeDocument,
} from '../modules/doc-summary/service.js';
import { DOC_SUMMARY_QUEUE_NAME } from '../queues/doc-summary.queue.js';

type DocSummaryJobData = { jobId: string; content: string };

export const docSummaryWorker = new Worker<DocSummaryJobData>(
  DOC_SUMMARY_QUEUE_NAME,
  async (job) => {
    const { jobId, content } = job.data;

    await markJobProcessing(jobId);
    try {
      const { title, summary } = await summarizeDocument(content);
      await completeJob(jobId, { title, summary });
    } catch (error) {
      await markJobFailed(
        jobId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  },
  { connection },
);

docSummaryWorker.on('completed', (job) => {
  console.log(`✅ doc-summary ${job.id} completed`);
});

docSummaryWorker.on('failed', (job, error) => {
  console.error(`❌ doc-summary ${job?.id} failed: ${error.message}`);
});
