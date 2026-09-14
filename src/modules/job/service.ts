// service
//
// Business logic + data access for the doc-summary job module.
// Never import `hono` here: everything below is callable from the worker too.

import z from 'zod';
import { desc, eq } from 'drizzle-orm';
import { generateCompletion } from '@anvia/core';

import { db } from '../../utils/db.js';
import { getModel } from '../../llm/models.js';
// import { queue } from '../../workers/doc-summary.worker.js';
import {
  docSummaryJobs,
  docSummaryResults,
} from '../../db/schema/doc-summary.schema.js';
import type { CreateJobInput } from './schema.js';
import { docSummarizeQueue } from '../../queues/doc-summary.queue.js';

const SummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
});

const SYSTEM_INSTRUCTIONS =
  'You are a document analyst. Reply with ONLY raw JSON (no markdown fences, no extra text) ' +
  'matching this shape: {"title": string, "summary": string}.';

/**
 * The gateway currently rejects `response_format: json_schema` (400
 * "This response_format type is unavailable now"), so `outputSchema` can't
 * be passed to generateCompletion. Ask for JSON in the prompt instead and
 * validate it ourselves.
 */
export async function summarizeDocument(content: string) {
  const res = await generateCompletion({
    model: getModel(),
    prompt: `Summarize the document below.\n\n---\n${content}\n---`,
    instructions: SYSTEM_INSTRUCTIONS,
  });

  const raw = res.output
    .trim()
    .replace(/^```(?:json)?|```$/g, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Model did not return valid JSON: ${raw.slice(0, 200)}`);
  }

  return SummarySchema.parse(parsed);
}

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

  await docSummarizeQueue.add('summarize-doc', {
    jobId: job.id,
    content: input.content,
  });

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
