// schema
import z from 'zod';

export const CreateDocSummaryJobSchema = z.object({
  content: z.string().min(1),
});

export type CreateDocSummaryJobInput = z.infer<
  typeof CreateDocSummaryJobSchema
>;

/** Payload put on the queue — the document body is never stored on the job row. */
export type DocSummaryJobPayload = {
  jobId: string;
  content: string;
};
