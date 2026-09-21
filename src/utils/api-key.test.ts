import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKey, hashKey } from './api-key.js';

test('hashKey is deterministic 64-char hex', () => {
  const h1 = hashKey('seal_abc');
  const h2 = hashKey('seal_abc');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('generateKey returns seal_-prefixed secret whose hash matches', () => {
  const { secret, prefix, hash } = generateKey();
  assert.match(secret, /^seal_[A-Za-z0-9_-]+$/);
  assert.ok(secret.startsWith(prefix));
  assert.match(prefix, /^seal_[A-Za-z0-9_-]{6}$/);
  assert.equal(hash, hashKey(secret));
  assert.notEqual(hash, secret);
});

test('generateKey produces distinct secrets', () => {
  assert.notEqual(generateKey().secret, generateKey().secret);
});
