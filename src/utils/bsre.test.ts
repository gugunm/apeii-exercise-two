import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSealTotp,
  sealPdf,
  type ActivationRow,
  type TotpDeps,
} from './bsre.js';
import type { SealConfig } from '../modules/e-seal/schema.js';

function makeDeps(activation: ActivationRow | null) {
  const calls: string[] = [];
  const deps: TotpDeps = {
    getActivation: async () => activation,
    refreshSealTotp: async (idSubscriber, act) => {
      calls.push(`seal:${idSubscriber}:${act}`);
      return { totp: 'SEAL-NEW', expires: '2026-09-17T10:00:00.000+0000' };
    },
    onRefresh: async () => {
      calls.push('refreshed');
    },
  };
  return { deps, calls };
}

test('requests a fresh seal TOTP with the stored id_subscriber and activation TOTP on every call', async () => {
  const { deps, calls } = makeDeps({ totp: 'ACT', idSubscriber: 'SUB' });
  assert.deepEqual(await getSealTotp(deps), {
    totp: 'SEAL-NEW',
    idSubscriber: 'SUB',
  });
  await getSealTotp(deps);
  assert.deepEqual(calls, [
    'seal:SUB:ACT',
    'refreshed',
    'seal:SUB:ACT',
    'refreshed',
  ]);
});

test('throws when the activation row is missing', async () => {
  const { deps, calls } = makeDeps(null);
  await assert.rejects(getSealTotp(deps), /BSRE_ACTIVATION_TOTP_NOT_SEEDED/);
  assert.deepEqual(calls, []);
});

test('throws when id_subscriber is empty on the activation row', async () => {
  const { deps, calls } = makeDeps({ totp: 'ACT', idSubscriber: null });
  await assert.rejects(
    getSealTotp(deps),
    /BSRE_ACTIVATION_ID_SUBSCRIBER_NOT_SEEDED/,
  );
  assert.deepEqual(calls, []);
});

const visible: SealConfig = {
  tampilan: 'VISIBLE',
  reason: 'null',
  page: 1,
  originX: 0,
  originY: 0,
  width: 150,
  height: 50,
  location: 'Jakarta',
  imageKey: 'B1/seal-image',
};

test('VISIBLE seal sends imageBase64 in signatureProperties', async () => {
  const realFetch = globalThis.fetch;
  let body: { signatureProperties: { imageBase64?: string }[] } | undefined;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ time: 1, file: ['x'] }));
  }) as typeof fetch;
  try {
    await sealPdf({
      idSubscriber: 'SUB',
      totp: 'T',
      sealConfig: visible,
      files: ['f'],
      imageBase64: 'IMG',
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(body?.signatureProperties[0]?.imageBase64, 'IMG');
});

test('VISIBLE seal without imageBase64 is rejected before any request', async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;
  try {
    for (const imageBase64 of [undefined, '']) {
      await assert.rejects(
        sealPdf({
          idSubscriber: 'SUB',
          totp: 'T',
          sealConfig: visible,
          files: ['f'],
          imageBase64,
        }),
        /VISIBLE seal requires imageBase64/,
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, false);
});
