import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateEsealSchema } from './schema.js';
import { createBatch, findBatch, listBatches } from './service.js';

export const esealRoute = new Hono()
  .post('/', zValidator('form', CreateEsealSchema), async (c) => {
    const batch = await createBatch(c.req.valid('form'));
    return c.json({ data: batch }, 202);
  })
  .get('/', async (c) => c.json({ data: await listBatches() }))
  .get('/:id', async (c) => {
    const batch = await findBatch(c.req.param('id'));
    if (!batch) return c.json({ error: 'Batch not found' }, 404);
    return c.json({ data: batch });
  });
