import type { Context } from 'hono';
import { findTte, listTtes } from './service.js';
import { tteQueue } from './service.js';

export function getTtes(c: Context) {
  return c.json({ data: listTtes() });
}

export async function getTte(c: Context) {
  const id = c.req.param('id');
  const tte = id ? findTte(id) : undefined;

  if (!tte) {
    return c.json({ error: 'TTE not found' }, 404);
  }

  await tteQueue.add('process-tte', {
    tteId: tte.id,
  });

  return c.json({ data: tte });
}
