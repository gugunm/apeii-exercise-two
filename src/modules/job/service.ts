// service
//
// Business logic + data access for the doc-summary job module.
// Never import `hono` here: everything below is callable from the worker too.

import z from 'zod';
import { desc, eq } from 'drizzle-orm';
import { generateCompletion } from '@anvia/core';

import { db } from '../../utils/db.js';
import { getModel } from '../../llm/models.js';
import { queue } from '../../worker/queue.js';
import {
  docSummaryJobs,
  docSummaryResults,
} from '../../db/schema/doc-summary.schema.js';
import type { CreateJobInput } from './schema.js';

const SummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
});

const SYSTEM_INSTRUCTIONS =
  'You are a document analyst. Return a short title and a concise summary of the document in JSON format.';

export function listJobs() {
  return db
    .select()
    .from(docSummaryJobs)
    .orderBy(desc(docSummaryJobs.createdAt));
}

export async function findJobWithResult(id: string) {
  const [job] = await db
    .select()
    .from(docSummaryJobs)
    .where(eq(docSummaryJobs.id, id));

  if (!job) return null;

  const [result] = await db
    .select()
    .from(docSummaryResults)
    .where(eq(docSummaryResults.jobId, id));

  return { ...job, result: result ?? null };
}

export async function createJob(input: CreateJobInput) {
  const [job] = await db
    .insert(docSummaryJobs)
    .values({
      filename: input.filename,
      mimeType: input.mimeType,
      fileSize: Buffer.byteLength(input.content, 'utf8'),
      status: 'PENDING',
    })
    .returning();

  if (!job) {
    throw new Error('Failed to create doc summary job');
  }

  await queue.add('summarize-doc', { jobId: job.id, content: input.content });

  return job;
}

export async function markJobProcessing(jobId: string) {
  await db
    .update(docSummaryJobs)
    .set({ status: 'PROCESSING', startedAt: new Date() })
    .where(eq(docSummaryJobs.id, jobId));
}

export async function markJobFailed(jobId: string, error: string) {
  await db
    .update(docSummaryJobs)
    .set({ status: 'FAILED', error, finishedAt: new Date() })
    .where(eq(docSummaryJobs.id, jobId));
}

export async function summarizeDocument(content: string) {
  const res = await generateCompletion({
    model: getModel(),
    prompt: `Summarize the document below.\n\n---\n${content}\n---`,
    instructions: SYSTEM_INSTRUCTIONS,
    outputSchema: SummarySchema,
  });

  return res.output;
}

export async function completeJob(
  jobId: string,
  result: { title: string; summary: string; content: string },
) {
  await db.insert(docSummaryResults).values({
    jobId,
    title: result.title,
    summary: result.summary,
    content: result.content,
  });

  await db
    .update(docSummaryJobs)
    .set({ status: 'COMPLETED', finishedAt: new Date() })
    .where(eq(docSummaryJobs.id, jobId));
}
