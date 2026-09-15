import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';

// import { tteRoute } from './modules/tte/route.js';
import { openApiDocument } from './openapi.js';
import { docSummaryRoute } from './modules/doc-summary/router.js';

export const app = new Hono();

app.get('/health', (c) => {
  return c.json({ status: '🔥 Hono is running!' });
});

app.get('/openapi.json', (c) => {
  return c.json(openApiDocument);
});

app.get(
  '/docs',
  Scalar({
    url: '/openapi.json',
    pageTitle: 'TTE API Reference',
  }),
);

// ===== route under the base path /api/v1 =====
// Keep the .route() calls chained: `AppType` below is what the hono/client
// (`hc<AppType>`) uses for end-to-end typesafety.
const api = app
  .basePath('/api/v1')
  // .route('/tte', tteRoute)
  .route('/doc-summary', docSummaryRoute);

export type AppType = typeof api;
