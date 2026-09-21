import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { scopeSatisfies, isValidScopeGrant, requireScope } from './scopes.js';
import type { ApiKeyContext } from '../modules/api-key/service.js';

test('scopeSatisfies: exact, resource wildcard, global wildcard', () => {
  assert.equal(scopeSatisfies(['eseal:write'], 'eseal:write'), true);
  assert.equal(scopeSatisfies(['eseal:*'], 'eseal:write'), true);
  assert.equal(scopeSatisfies(['*'], 'eseal:write'), true);
  assert.equal(scopeSatisfies(['eseal:read'], 'eseal:write'), false);
  assert.equal(scopeSatisfies(['docsummary:*'], 'eseal:write'), false);
  assert.equal(scopeSatisfies([], 'eseal:write'), false);
});

test('isValidScopeGrant: known scopes and wildcards only', () => {
  assert.equal(isValidScopeGrant('eseal:read'), true);
  assert.equal(isValidScopeGrant('eseal:*'), true);
  assert.equal(isValidScopeGrant('*'), true);
  assert.equal(isValidScopeGrant('eseal:delete'), false);
  assert.equal(isValidScopeGrant('unknown:*'), false);
  assert.equal(isValidScopeGrant('garbage'), false);
});

test('requireScope: 403 when missing, next when satisfied', async () => {
  const app = new Hono<{ Variables: { apiKey: ApiKeyContext } }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', { id: 'k', name: 'n', scopes: ['eseal:read'] });
    await next();
  });
  app.get('/w', requireScope('eseal:write'), (c) => c.text('ok'));
  app.get('/r', requireScope('eseal:read'), (c) => c.text('ok'));

  assert.equal((await app.request('/w')).status, 403);
  assert.equal((await app.request('/r')).status, 200);
});
