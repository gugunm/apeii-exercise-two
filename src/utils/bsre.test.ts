import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSealTotp, type ActivationRow, type TotpDeps } from './bsre.js';

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
