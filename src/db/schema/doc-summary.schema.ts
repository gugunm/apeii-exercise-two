import {
  pgTable,
  pgEnum,
  varchar,
  text,
  timestamp,
  index,
  char,
} from 'drizzle-orm/pg-core';
import { defineRelations } from 'drizzle-orm';
import { ulid } from 'ulid';

export const docSummaryJobStatusEnum = pgEnum('doc_summary_job_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const docSummaryJobs = pgTable(
  'doc_summary_jobs',
  {
    id: char('id', { length: 26 })
      .$defaultFn(() => ulid())
      .primaryKey(),

    content: text('content').notNull(),

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
  id: char('id', { length: 26 })
    .$defaultFn(() => ulid())
    .primaryKey(),

  jobId: char('job_id', { length: 26 })
    .notNull()
    .unique()
    .references(() => docSummaryJobs.id, { onDelete: 'cascade' }),

  content_title: varchar('content_title', { length: 255 }).notNull(),

  content_summary: text('content_summary').notNull(),

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
