import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateKeySchema, UpdateKeySchema } from './schema.js';
import {
  createKey,
  getKey,
  listKeys,
  revokeKey,
  rotateKey,
  updateKey,
} from './service.js';

export const apiKeyRoute = new Hono()
  .post('/', zValidator('json', CreateKeySchema), async (c) => {
    const data = await createKey(c.req.valid('json'));
    return c.json({ data }, 201);
  })
  .get('/', async (c) => c.json({ data: await listKeys() }))
  .get('/:id', async (c) => {
    const key = await getKey(c.req.param('id'));
    if (!key) return c.json({ error: 'Key not found' }, 404);
    return c.json({ data: key });
  })
  .patch('/:id', zValidator('json', UpdateKeySchema), async (c) => {
    const key = await updateKey(c.req.param('id'), c.req.valid('json'));
    if (!key) return c.json({ error: 'Key not found' }, 404);
    return c.json({ data: key });
  })
  .post('/:id/revoke', async (c) => {
    const key = await revokeKey(c.req.param('id'));
    if (!key) return c.json({ error: 'Key not found' }, 404);
    return c.json({ data: key });
  })
  .post('/:id/rotate', async (c) => {
    const result = await rotateKey(c.req.param('id'));
    if (!result.ok) {
      if (result.reason === 'not_found')
        return c.json({ error: 'Key not found' }, 404);
      return c.json(
        { error: 'Key is not active; rotation requires an active key' },
        409,
      );
    }
    return c.json({ data: result.key });
  });
