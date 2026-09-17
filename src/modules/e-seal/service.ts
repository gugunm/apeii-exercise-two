import { asc, desc, eq, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '../../utils/db.js';
import { getObject, presignGet, putObject } from '../../utils/s3.js';
import {
  esealBatches,
  esealFiles,
  esealLogs,
} from '../../db/schema/e-seal.schema.js';
import { esealQueue } from '../../queues/e-seal.queue.js';
import { toSealConfig, type CreateEsealInput } from './schema.js';

export type BatchStep = (typeof esealBatches.$inferSelect)['currentStep'];

export type LogEntry = {
  level: 'INFO' | 'ERROR';
  step: BatchStep;
  message: string;
  meta?: Record<string, unknown>;
};

const SIGNED_URL_TTL = Number(process.env.ESEAL_SIGNED_URL_TTL ?? 900);

const rawKey = (batchId: string, position: number) =>
  `${batchId}/raw/${position}.pdf`;

export async function logBatch(batchId: string, entry: LogEntry) {
  await db.insert(esealLogs).values({
    batchId,
    level: entry.level,
    step: entry.step,
    message: entry.message,
    meta: entry.meta ?? null,
  });
}

export async function createBatch(input: CreateEsealInput) {
  const files = input['files[]'];
  const batchId = ulid();

  // Upload first: if S3 fails there is nothing to roll back in the DB.
  await Promise.all(
    files.map(async (file, i) =>
      putObject(
        rawKey(batchId, i),
        Buffer.from(await file.arrayBuffer()),
        'application/pdf',
      ),
    ),
  );

  await db.transaction(async (tx) => {
    await tx.insert(esealBatches).values({
      id: batchId,
      userId: input.userId,
      sealConfig: toSealConfig(input),
    });
    await tx.insert(esealFiles).values(
      files.map((file, i) => ({
        batchId,
        position: i,
        originalFilename: file.name,
        fileSize: file.size,
        rawPath: rawKey(batchId, i),
      })),
    );
    await tx.insert(esealLogs).values({
      batchId,
      level: 'INFO',
      step: 'QUEUED',
      message: `Batch created with ${files.length} files`,
    });
  });

  await esealQueue.add('seal', { batchId }, { jobId: batchId });

  return {
    id: batchId,
    status: 'PENDING' as const,
    totalFiles: files.length,
    statusUrl: `/api/v1/e-seal/${batchId}`,
  };
}

export function listBatches() {
  return db.select().from(esealBatches).orderBy(desc(esealBatches.createdAt));
}

export async function findBatch(id: string) {
  const [batch] = await db
    .select()
    .from(esealBatches)
    .where(eq(esealBatches.id, id));
  if (!batch) return null;

  const files = await db
    .select()
    .from(esealFiles)
    .where(eq(esealFiles.batchId, id))
    .orderBy(asc(esealFiles.position));

  const logs = await db
    .select({
      level: esealLogs.level,
      step: esealLogs.step,
      message: esealLogs.message,
      meta: esealLogs.meta,
      createdAt: esealLogs.createdAt,
    })
    .from(esealLogs)
    .where(eq(esealLogs.batchId, id))
    .orderBy(asc(esealLogs.createdAt));

  const filesOut = await Promise.all(
    files.map(async (f) => ({
      id: f.id,
      filename: f.originalFilename,
      fileSize: f.fileSize,
      downloadUrl:
        batch.status === 'COMPLETED' && f.verifiedPath
          ? await presignGet(f.verifiedPath, SIGNED_URL_TTL)
          : null,
    })),
  );

  return { ...batch, files: filesOut, logs };
}

export type FileKind = 'raw' | 'verified';

/** Returns null when the file does not belong to the batch or the verified copy is not ready yet. */
export async function getFileForServing(
  batchId: string,
  fileId: string,
  kind: FileKind,
) {
  const [file] = await db
    .select({
      batchId: esealFiles.batchId,
      originalFilename: esealFiles.originalFilename,
      rawPath: esealFiles.rawPath,
      verifiedPath: esealFiles.verifiedPath,
    })
    .from(esealFiles)
    .where(eq(esealFiles.id, fileId));
  if (!file || file.batchId !== batchId) return null;

  const key = kind === 'raw' ? file.rawPath : file.verifiedPath;
  if (!key) return null;

  return { buffer: await getObject(key), filename: file.originalFilename };
}

// ---------- worker-side transitions ----------

export async function loadBatchForSealing(batchId: string) {
  const [batch] = await db
    .select({ id: esealBatches.id, sealConfig: esealBatches.sealConfig })
    .from(esealBatches)
    .where(eq(esealBatches.id, batchId));
  if (!batch) return null;

  const files = await db
    .select({
      id: esealFiles.id,
      position: esealFiles.position,
      rawPath: esealFiles.rawPath,
    })
    .from(esealFiles)
    .where(eq(esealFiles.batchId, batchId))
    .orderBy(asc(esealFiles.position));

  return { batch, files };
}

export async function markBatchProcessing(batchId: string) {
  await db
    .update(esealBatches)
    .set({
      status: 'PROCESSING',
      currentStep: 'DOWNLOADING',
      startedAt: sql`COALESCE(${esealBatches.startedAt}, NOW())`,
    })
    .where(eq(esealBatches.id, batchId));
}

export async function markBatchStep(
  batchId: string,
  step: 'SEALING' | 'UPLOADING',
) {
  await db
    .update(esealBatches)
    .set({ currentStep: step })
    .where(eq(esealBatches.id, batchId));
}

export async function setVerifiedPath(fileId: string, verifiedPath: string) {
  await db
    .update(esealFiles)
    .set({ verifiedPath })
    .where(eq(esealFiles.id, fileId));
}

export async function markBatchCompleted(batchId: string) {
  await db
    .update(esealBatches)
    .set({
      status: 'COMPLETED',
      currentStep: 'COMPLETED',
      finishedAt: new Date(),
    })
    .where(eq(esealBatches.id, batchId));
}

export async function markBatchRetry(batchId: string, error: string) {
  await db
    .update(esealBatches)
    .set({ currentStep: 'QUEUED', error })
    .where(eq(esealBatches.id, batchId));
}

export async function markBatchFailed(batchId: string, error: string) {
  await db
    .update(esealBatches)
    .set({
      status: 'FAILED',
      currentStep: 'FAILED',
      error,
      finishedAt: new Date(),
    })
    .where(eq(esealBatches.id, batchId));
}
