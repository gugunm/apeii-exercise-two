import { Hono } from 'hono';
import {
  createJob,
  findJobWithResult,
  listJobs,
  summarizeDocument,
} from './service.js';
import { zValidator } from '@hono/zod-validator';
import { CreateJobSchema } from './schema.js';

export const jobRoute = new Hono()
  .get('/', async (c) => c.json({ data: await listJobs() }))
  .post('/', zValidator('json', CreateJobSchema), async (c) => {
    const job = await createJob(c.req.valid('json'));
    return c.json({ data: job }, 202); // job.id, status PENDING — bukan summary
  })
  .get('/:id', async (c) => {
    const job = await findJobWithResult(c.req.param('id'));
    if (!job) return c.json({ error: 'Job not found' }, 404);
    return c.json({ data: job });
  });

// export const jobRoute = new Hono().get('/', async (c) => {
//   const summResult = await summarizeDocument(
//     'manusia terpintar di dunia adalah dari bangsa persia',
//   );

//   return c.json({ data: summResult });
//   // return c.json({ data: await listJobs() });
// });
// .get('/:id', async (c) => {
//   const job = await findJobWithResult(c.req.param('id'));

//   if (!job) {
//     return c.json({ error: 'Job not found' }, 404);
//   }

//   return c.json({ data: job });
// })
// .post('/', zValidator('json', CreateJobSchema), async (c) => {
//   const job = await createJob(c.req.valid('json'));

//   return c.json({ data: job }, 202);
// });
