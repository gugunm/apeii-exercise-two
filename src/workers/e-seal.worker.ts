import { Worker } from 'bullmq';
import { connection } from '../utils/redis.js';
import { ESEAL_QUEUE_NAME } from '../queues/e-seal.queue.js';
import type { EsealJobPayload } from '../modules/e-seal/schema.js';
import {
  sealBatch,
  type SealBatchDeps,
} from '../modules/e-seal/seal-batch.js';
import * as service from '../modules/e-seal/service.js';
import * as s3 from '../utils/s3.js';
import {
  dbActivation,
  getSealTotp,
  refreshSealTotp,
  sealPdf,
} from '../utils/bsre.js';

const deps: SealBatchDeps = {
  loadBatch: service.loadBatchForSealing,
  markProcessing: service.markBatchProcessing,
  markStep: service.markBatchStep,
  setVerifiedPath: service.setVerifiedPath,
  markCompleted: service.markBatchCompleted,
  markRetry: service.markBatchRetry,
  markFailed: service.markBatchFailed,
  log: service.logBatch,
  getObject: s3.getObject,
  putObject: s3.putObject,
  getSealTotp: (onRefresh) =>
    getSealTotp({
      getActivation: dbActivation,
      refreshSealTotp,
      onRefresh,
    }),
  sealPdf,
  sealImageKey: process.env.BSRE_SEAL_IMAGE_KEY ?? '',
};

export const esealWorker = new Worker<EsealJobPayload>(
  ESEAL_QUEUE_NAME,
  async (job) => {
    await sealBatch(
      job.data.batchId,
      { current: job.attemptsStarted, max: job.opts.attempts ?? 1 },
      deps,
    );
  },
  { connection, concurrency: 1 },
);

esealWorker.on('completed', (job) => {
  console.log(`✅ e-seal ${job.id} completed`);
});

esealWorker.on('failed', (job, error) => {
  console.error(`❌ e-seal ${job?.id} failed: ${error.message}`);
});
