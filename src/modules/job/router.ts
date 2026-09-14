// route
//
// Chained so Hono can infer the RPC type. Handlers stay one-liners:
// read input, call the service, pick the status code.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import { CreateJobSchema } from './schema.js';
import { createJob, findJobWithResult, listJobs } from './service.js';

export const jobRoute = new Hono()
  .get('/', async (c) => {
    return c.json({ data: await listJobs() });
  })
  .get('/:id', async (c) => {
    const job = await findJobWithResult(c.req.param('id'));

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    return c.json({ data: job });
  })
  .post('/', zValidator('json', CreateJobSchema), async (c) => {
    const job = await createJob(c.req.valid('json'));

    return c.json({ data: job }, 202);
  });
