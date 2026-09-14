// schema
import z from 'zod';

export const CreateJobSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100).default('text/plain'),
  content: z.string().min(1),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

/** Payload put on the queue — the document body is never stored on the job row. */
export type DocSummaryJobPayload = {
  jobId: string;
  content: string;
};
