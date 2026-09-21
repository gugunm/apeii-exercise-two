import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './app.js';

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

test('health is public', async () => {
  assert.equal((await app.request('/health')).status, 200);
});

test('api routes require a key', async () => {
  assert.equal((await app.request('/api/v1/e-seal')).status, 401);
  assert.equal((await app.request('/api/v1/doc-summary')).status, 401);
});

test('admin routes require the admin key', async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'admin-secret';
  assert.equal((await app.request('/admin/keys')).status, 401);
  assert.equal((await app.request('/admin/keys', bearer('nope'))).status, 401);
  process.env.ADMIN_API_KEY = prev;
});

test('docs and openapi are public', async () => {
  assert.equal((await app.request('/openapi.json')).status, 200);
  assert.equal((await app.request('/docs')).status, 200);
});
