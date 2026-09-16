import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSealTotp,
  parseBsreDate,
  type TotpDeps,
  type TotpKind,
  type TotpRow,
} from './bsre.js';

const NOW = new Date('2026-09-16T10:00:00Z');
const inOneHour = new Date(NOW.getTime() + 3_600_000);
const inTenSeconds = new Date(NOW.getTime() + 10_000);

function makeDeps(rows: Partial<Record<TotpKind, TotpRow>>) {
  const store = new Map<TotpKind, TotpRow>(
    Object.entries(rows) as [TotpKind, TotpRow][],
  );
  const calls: string[] = [];
  const deps: TotpDeps = {
    get: async (kind) => store.get(kind) ?? null,
    set: async (kind, row) => {
      store.set(kind, row);
    },
    refreshActivationTotp: async (current) => {
      calls.push(`activation:${current}`);
      return { totp: 'ACT-NEW', expires: '2026-09-18T06:51:16.407+0000' };
    },
    refreshSealTotp: async (activation) => {
      calls.push(`seal:${activation}`);
      return { totp: 'SEAL-NEW', expires: '2026-09-17T10:00:00.000+0000' };
    },
    onRefresh: async (kind) => {
      calls.push(`refreshed:${kind}`);
    },
    now: () => NOW,
  };
  return { deps, store, calls };
}

test('parseBsreDate handles +0000 offset', () => {
  assert.equal(
    parseBsreDate('2026-09-18T06:51:16.407+0000').toISOString(),
    '2026-09-18T06:51:16.407Z',
  );
});

test('returns cached SEAL totp when valid', async () => {
  const { deps, calls } = makeDeps({
    ACTIVATION: { totp: 'ACT', expiresAt: inOneHour },
    SEAL: { totp: 'SEAL', expiresAt: inOneHour },
  });
  assert.equal(await getSealTotp(deps), 'SEAL');
  assert.deepEqual(calls, []);
});

test('SEAL expiring within 60s counts as expired and is refreshed', async () => {
  const { deps, store, calls } = makeDeps({
    ACTIVATION: { totp: 'ACT', expiresAt: inOneHour },
    SEAL: { totp: 'SEAL', expiresAt: inTenSeconds },
  });
  assert.equal(await getSealTotp(deps), 'SEAL-NEW');
  assert.deepEqual(calls, ['seal:ACT', 'refreshed:SEAL']);
  assert.equal(store.get('SEAL')?.totp, 'SEAL-NEW');
  assert.equal(
    store.get('SEAL')?.expiresAt.toISOString(),
    '2026-09-17T10:00:00.000Z',
  );
});

test('missing SEAL row is created from a valid ACTIVATION', async () => {
  const { deps, calls } = makeDeps({
    ACTIVATION: { totp: 'ACT', expiresAt: inOneHour },
  });
  assert.equal(await getSealTotp(deps), 'SEAL-NEW');
  assert.deepEqual(calls, ['seal:ACT', 'refreshed:SEAL']);
});

test('expired ACTIVATION is refreshed first, then SEAL', async () => {
  const { deps, store, calls } = makeDeps({
    ACTIVATION: { totp: 'ACT-OLD', expiresAt: inTenSeconds },
  });
  assert.equal(await getSealTotp(deps), 'SEAL-NEW');
  assert.deepEqual(calls, [
    'activation:ACT-OLD',
    'refreshed:ACTIVATION',
    'seal:ACT-NEW',
    'refreshed:SEAL',
  ]);
  assert.equal(store.get('ACTIVATION')?.totp, 'ACT-NEW');
});

test('throws when ACTIVATION row is missing', async () => {
  const { deps } = makeDeps({});
  await assert.rejects(getSealTotp(deps), /BSRE_ACTIVATION_TOTP_NOT_SEEDED/);
});
