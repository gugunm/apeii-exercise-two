// Pure worker logic. Type-only imports: pulling in service/queue modules would
// open the ioredis connection at import time and hang the unit tests.
import type { SealConfig } from './schema.js';
import type { BatchStep, LogEntry } from './service.js';
import type {
  SealPdfArgs,
  SealPdfResult,
  SealTotp,
} from '../../utils/bsre.js';

export type SealBatchDeps = {
  loadBatch(batchId: string): Promise<{
    batch: { id: string; sealConfig: SealConfig };
    files: { id: string; position: number; rawPath: string }[];
  } | null>;
  markProcessing(batchId: string): Promise<void>;
  markStep(batchId: string, step: 'SEALING' | 'UPLOADING'): Promise<void>;
  setVerifiedPath(fileId: string, verifiedPath: string): Promise<void>;
  markCompleted(batchId: string): Promise<void>;
  markRetry(batchId: string, error: string): Promise<void>;
  markFailed(batchId: string, error: string): Promise<void>;
  log(batchId: string, entry: LogEntry): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getSealTotp(onRefresh: () => Promise<void>): Promise<SealTotp>;
  sealPdf(args: SealPdfArgs): Promise<SealPdfResult>;
  sealImageKey: string;
};

export type Attempt = { current: number; max: number };

export async function sealBatch(
  batchId: string,
  attempt: Attempt,
  deps: SealBatchDeps,
): Promise<void> {
  const loaded = await deps.loadBatch(batchId);
  if (!loaded) throw new Error(`Batch ${batchId} not found`);
  const { batch, files } = loaded;

  let step: BatchStep = 'DOWNLOADING';
  try {
    await deps.markProcessing(batchId);
    const base64Files = await Promise.all(
      files.map(async (f) =>
        (await deps.getObject(f.rawPath)).toString('base64'),
      ),
    );
    const imageBase64 =
      batch.sealConfig.tampilan === 'VISIBLE'
        ? (await deps.getObject(deps.sealImageKey)).toString('base64')
        : undefined;
    await deps.log(batchId, {
      level: 'INFO',
      step,
      message: `Downloaded ${files.length} files from S3`,
    });

    step = 'SEALING';
    await deps.markStep(batchId, step);
    const { totp, idSubscriber } = await deps.getSealTotp(() =>
      deps.log(batchId, {
        level: 'INFO',
        step: 'SEALING',
        message: 'Seal TOTP refreshed',
      }),
    );
    const sealed = await deps.sealPdf({
      idSubscriber,
      totp,
      sealConfig: batch.sealConfig,
      files: base64Files,
      imageBase64,
    });
    if (sealed.file.length !== files.length) {
      throw new Error(
        `BSrE returned ${sealed.file.length} files, expected ${files.length}`,
      );
    }
    await deps.log(batchId, {
      level: 'INFO',
      step,
      message: `BSrE sealed ${files.length} files`,
      meta: { time: sealed.time },
    });

    step = 'UPLOADING';
    await deps.markStep(batchId, step);
    await Promise.all(
      files.map(async (f, i) => {
        const key = `${batchId}/verified/${f.position}.pdf`;
        await deps.putObject(
          key,
          Buffer.from(sealed.file[i]!, 'base64'),
          'application/pdf',
        );
        await deps.setVerifiedPath(f.id, key);
      }),
    );
    await deps.log(batchId, {
      level: 'INFO',
      step,
      message: `Uploaded ${files.length} verified files`,
    });

    await deps.markCompleted(batchId);
    await deps.log(batchId, {
      level: 'INFO',
      step: 'COMPLETED',
      message: 'Batch completed',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isFinal = attempt.current >= attempt.max;
    await deps.log(batchId, {
      level: 'ERROR',
      step,
      message,
      meta: { attempt: attempt.current, willRetry: !isFinal },
    });
    if (isFinal) await deps.markFailed(batchId, message);
    else await deps.markRetry(batchId, message);
    throw error;
  }
}
