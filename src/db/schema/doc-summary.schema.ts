import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { defineRelations } from 'drizzle-orm';

export const docSummaryJobStatusEnum = pgEnum('doc_summary_job_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const docSummaryJobs = pgTable(
  'doc_summary_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),

    fileSize: bigint('file_size', {
      mode: 'number',
    }).notNull(),

    status: docSummaryJobStatusEnum('status').default('PENDING').notNull(),

    error: text('error'),

    startedAt: timestamp('started_at', {
      withTimezone: true,
    }),

    finishedAt: timestamp('finished_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('doc_summary_jobs_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const docSummaryResults = pgTable('doc_summary_results', {
  id: uuid('id').defaultRandom().primaryKey(),

  jobId: uuid('job_id')
    .notNull()
    .unique()
    .references(() => docSummaryJobs.id, {
      onDelete: 'cascade',
    }),

  title: varchar('title', { length: 255 }).notNull(),

  content: text('content').notNull(),
  summary: text('summary').notNull(),

  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp('updated_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const docSummaryRelations = defineRelations(
  { docSummaryJobs, docSummaryResults },
  (r) => ({
    docSummaryJobs: {
      result: r.one.docSummaryResults({
        from: r.docSummaryJobs.id,
        to: r.docSummaryResults.jobId,
      }),
    },
    docSummaryResults: {
      job: r.one.docSummaryJobs({
        from: r.docSummaryResults.jobId,
        to: r.docSummaryJobs.id,
      }),
    },
  }),
);
