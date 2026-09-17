import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateEsealSchema } from './schema.js';
import {
  createBatch,
  findBatch,
  getFileForServing,
  listBatchFiles,
  listBatches,
} from './service.js';

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
  })
  .get('/:id/files', async (c) => {
    const files = await listBatchFiles(c.req.param('id'));
    if (!files) return c.json({ error: 'Batch not found' }, 404);
    return c.json({ data: files });
  })
  // Streams the PDF through the API so the S3 endpoint never has to be
  // reachable from the client. `?download=1` forces a save dialog.
  .get('/:id/files/:fileId/:kind{raw|verified}', async (c) => {
    const { id, fileId, kind } = c.req.param();
    const file = await getFileForServing(id, fileId, kind as 'raw' | 'verified');
    if (!file) return c.json({ error: 'File not found' }, 404);

    const disposition = c.req.query('download') ? 'attachment' : 'inline';
    const base = file.filename.replace(/\.pdf$/i, '');
    const filename = encodeURIComponent(
      kind === 'verified' ? `${base}_verified.pdf` : `${base}.pdf`,
    );
    return c.body(new Uint8Array(file.buffer), 200, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.buffer.length),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${filename}`,
    });
  });
