import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isApiKeyValid } from './service.js';
import { CreateKeySchema } from './schema.js';

const now = new Date('2026-09-21T00:00:00Z');

test('isApiKeyValid: active when not revoked and not expired', () => {
  assert.equal(isApiKeyValid({ revokedAt: null, expiresAt: null }, now), true);
  assert.equal(
    isApiKeyValid(
      { revokedAt: null, expiresAt: new Date('2999-01-01T00:00:00Z') },
      now,
    ),
    true,
  );
});

test('isApiKeyValid: false when revoked', () => {
  assert.equal(isApiKeyValid({ revokedAt: now, expiresAt: null }, now), false);
});

test('isApiKeyValid: false when expired (<= now)', () => {
  assert.equal(
    isApiKeyValid(
      { revokedAt: null, expiresAt: new Date('2020-01-01T00:00:00Z') },
      now,
    ),
    false,
  );
});

test('CreateKeySchema: rejects unknown scope, accepts wildcard, nulls missing expiry', () => {
  assert.equal(
    CreateKeySchema.safeParse({ name: 'x', scopes: ['eseal:delete'] }).success,
    false,
  );
  const ok = CreateKeySchema.safeParse({ name: 'x', scopes: ['eseal:*'] });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.expiresAt, null);
});

test('CreateKeySchema: parses ISO expiresAt to Date', () => {
  const r = CreateKeySchema.safeParse({
    name: 'x',
    scopes: ['eseal:read'],
    expiresAt: '2027-01-01T00:00:00Z',
  });
  assert.equal(r.success, true);
  if (r.success) assert.ok(r.data.expiresAt instanceof Date);
});
