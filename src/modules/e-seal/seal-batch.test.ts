import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealBatch, type SealBatchDeps } from './seal-batch.js';
import type { SealConfig } from './schema.js';

type Call = [string, ...unknown[]];

function makeDeps(opts: {
  sealConfig?: SealConfig;
  sealedFiles?: string[];
  sealError?: Error;
}) {
  const calls: Call[] = [];
  const sealConfig: SealConfig = opts.sealConfig ?? {
    tampilan: 'INVISIBLE',
    reason: 'null',
  };
  const files = [
    { id: 'f0', position: 0, rawPath: 'B1/raw/0.pdf' },
    { id: 'f1', position: 1, rawPath: 'B1/raw/1.pdf' },
  ];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };

  const deps: SealBatchDeps = {
    loadBatch: async () => ({ batch: { id: 'B1', sealConfig }, files }),
    markProcessing: record('markProcessing'),
    markStep: record('markStep'),
    setVerifiedPath: record('setVerifiedPath'),
    markCompleted: record('markCompleted'),
    markRetry: record('markRetry'),
    markFailed: record('markFailed'),
    log: async (_batchId, entry) => {
      calls.push(['log', entry.level, entry.step, entry.message, entry.meta]);
    },
    getObject: async (key) => Buffer.from(`content-of-${key}`),
    putObject: async (key, body) => {
      calls.push(['putObject', key, body.toString()]);
    },
    getSealTotp: async (onRefresh) => {
      await onRefresh();
      return { totp: 'TOTP', idSubscriber: 'SUB' };
    },
    sealPdf: async (args) => {
      calls.push([
        'sealPdf',
        args.totp,
        args.files.length,
        args.imageBase64,
        args.idSubscriber,
      ]);
      if (opts.sealError) throw opts.sealError;
      return {
        time: 42,
        file:
          opts.sealedFiles ??
          args.files.map((f) => Buffer.from(`sealed-${f}`).toString('base64')),
      };
    },
    sealImageKey: 'seal.png',
  };
  return { deps, calls };
}

const stepsLogged = (calls: Call[]) =>
  calls.filter((c) => c[0] === 'log').map((c) => `${c[1]}:${c[2]}`);

test('happy path: steps, uploads, logs in order', async () => {
  const { deps, calls } = makeDeps({});
  await sealBatch('B1', { current: 1, max: 3 }, deps);

  assert.deepEqual(stepsLogged(calls), [
    'INFO:DOWNLOADING',
    'INFO:SEALING', // Seal TOTP refreshed
    'INFO:SEALING', // BSrE sealed
    'INFO:UPLOADING',
    'INFO:COMPLETED',
  ]);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'putObject').map((c) => c[1]),
    ['B1/verified/0.pdf', 'B1/verified/1.pdf'],
  );
  assert.deepEqual(
    calls.filter((c) => c[0] === 'setVerifiedPath'),
    [
      ['setVerifiedPath', 'f0', 'B1/verified/0.pdf'],
      ['setVerifiedPath', 'f1', 'B1/verified/1.pdf'],
    ],
  );
  assert.ok(calls.some((c) => c[0] === 'markCompleted'));
  assert.ok(!calls.some((c) => c[0] === 'markFailed'));
  // INVISIBLE: no seal image fetched
  const seal = calls.find((c) => c[0] === 'sealPdf')!;
  assert.equal(seal[3], undefined);
  // id_subscriber from the seal TOTP step is the one used for seal/pdf
  assert.equal(seal[4], 'SUB');
});

test('VISIBLE passes the seal image as base64', async () => {
  const { deps, calls } = makeDeps({
    sealConfig: {
      tampilan: 'VISIBLE',
      reason: 'null',
      page: 1,
      originX: 0,
      originY: 0,
      width: 150,
      height: 50,
      location: 'Jakarta',
    },
  });
  await sealBatch('B1', { current: 1, max: 3 }, deps);
  const seal = calls.find((c) => c[0] === 'sealPdf')!;
  assert.equal(seal[3], Buffer.from('content-of-seal.png').toString('base64'));
});

test('file count mismatch throws and marks retry on non-final attempt', async () => {
  const { deps, calls } = makeDeps({ sealedFiles: ['only-one'] });
  await assert.rejects(
    sealBatch('B1', { current: 1, max: 3 }, deps),
    /BSrE returned 1 files, expected 2/,
  );
  assert.deepEqual(
    calls.filter((c) => c[0] === 'markRetry'),
    [['markRetry', 'B1', 'BSrE returned 1 files, expected 2']],
  );
  assert.ok(!calls.some((c) => c[0] === 'markFailed'));
  const errLog = calls.find((c) => c[0] === 'log' && c[1] === 'ERROR')!;
  assert.equal(errLog[2], 'SEALING');
  assert.deepEqual(errLog[4], { attempt: 1, willRetry: true });
});

test('final attempt marks FAILED', async () => {
  const { deps, calls } = makeDeps({ sealError: new Error('BSrE down') });
  await assert.rejects(
    sealBatch('B1', { current: 3, max: 3 }, deps),
    /BSrE down/,
  );
  assert.deepEqual(
    calls.filter((c) => c[0] === 'markFailed'),
    [['markFailed', 'B1', 'BSrE down']],
  );
  assert.ok(!calls.some((c) => c[0] === 'markRetry'));
  const errLog = calls.find((c) => c[0] === 'log' && c[1] === 'ERROR')!;
  assert.deepEqual(errLog[4], { attempt: 3, willRetry: false });
});

test('missing batch throws without touching state', async () => {
  const { deps, calls } = makeDeps({});
  deps.loadBatch = async () => null;
  await assert.rejects(
    sealBatch('NOPE', { current: 1, max: 3 }, deps),
    /Batch NOPE not found/,
  );
  assert.deepEqual(calls, []);
});
