import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { apiKeyAuth } from './api-key-auth.js';
import { adminAuth } from './admin-auth.js';
import { requireScope } from './scopes.js';
import type { ApiKeyContext } from '../modules/api-key/service.js';

function appWithAuth(verifyKey: (t: string) => Promise<ApiKeyContext | null>) {
  const app = new Hono<{ Variables: { apiKey: ApiKeyContext } }>();
  app.use('/api/*', apiKeyAuth({ verifyKey }));
  app.get('/api/write', requireScope('eseal:write'), (c) => c.text('ok'));
  app.get('/api/read', requireScope('eseal:read'), (c) => c.text('ok'));
  return app;
}

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

test('apiKeyAuth: no key -> 401', async () => {
  const app = appWithAuth(async () => null);
  assert.equal((await app.request('/api/read')).status, 401);
});

test('apiKeyAuth: invalid key -> 401', async () => {
  const app = appWithAuth(async () => null);
  assert.equal((await app.request('/api/read', bearer('bad'))).status, 401);
});

test('apiKeyAuth + requireScope: valid key wrong scope -> 403', async () => {
  const app = appWithAuth(async () => ({
    id: 'k',
    name: 'n',
    scopes: ['eseal:read'],
  }));
  assert.equal((await app.request('/api/write', bearer('good'))).status, 403);
});

test('apiKeyAuth + requireScope: valid key right scope -> 200', async () => {
  const app = appWithAuth(async () => ({
    id: 'k',
    name: 'n',
    scopes: ['eseal:write'],
  }));
  assert.equal((await app.request('/api/write', bearer('good'))).status, 200);
});

test('adminAuth: missing env or token -> 401, correct -> 200', async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'secret-admin';
  const app = new Hono();
  app.use('/admin/*', adminAuth());
  app.get('/admin/ping', (c) => c.text('ok'));

  assert.equal((await app.request('/admin/ping')).status, 401);
  assert.equal((await app.request('/admin/ping', bearer('wrong'))).status, 401);
  assert.equal(
    (await app.request('/admin/ping', bearer('secret-admin'))).status,
    200,
  );

  process.env.ADMIN_API_KEY = prev;
});
