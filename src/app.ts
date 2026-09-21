import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';

import { openApiDocument } from './openapi.js';
import { docSummaryRoute } from './modules/doc-summary/router.js';
import { esealRoute } from './modules/e-seal/router.js';
import { apiKeyRoute } from './modules/api-key/router.js';
import { apiKeyAuth } from './middlewares/api-key-auth.js';
import { adminAuth } from './middlewares/admin-auth.js';
import type { ApiKeyContext } from './modules/api-key/service.js';

if (!process.env.ADMIN_API_KEY) {
  console.warn(
    '⚠️  ADMIN_API_KEY is not set — admin routes and docs will reject all requests.',
  );
}

export const app = new Hono<{ Variables: { apiKey: ApiKeyContext } }>();

// Public liveness probe.
app.get('/health', (c) => c.json({ status: '🔥 Hono is running!' }));

// Docs + admin key management: behind the admin key.
app.use('/openapi.json', adminAuth());
app.use('/docs', adminAuth());
app.use('/admin/*', adminAuth());

app.get('/openapi.json', (c) => c.json(openApiDocument));
app.get(
  '/docs',
  Scalar({ url: '/openapi.json', pageTitle: 'TTE API Reference' }),
);
app.route('/admin/keys', apiKeyRoute);

// Business API: behind an API key; per-route scope guards live in the routers.
app.use('/api/v1/*', apiKeyAuth());

// ===== route under the base path /api/v1 =====
// Keep the .route() calls chained: `AppType` below is what the hono/client
// (`hc<AppType>`) uses for end-to-end typesafety.
const api = app
  .basePath('/api/v1')
  .route('/doc-summary', docSummaryRoute)
  .route('/e-seal', esealRoute);

export type AppType = typeof api;
