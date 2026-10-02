import {
  pgTable,
  pgEnum,
  char,
  varchar,
  text,
  jsonb,
  smallint,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { defineRelations } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { SealConfig } from '../../modules/e-seal/schema.js';

export const esealBatchStatusEnum = pgEnum('eseal_batch_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const esealBatchStepEnum = pgEnum('eseal_batch_step', [
  'QUEUED',
  'DOWNLOADING',
  'SEALING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
]);

export const esealLogLevelEnum = pgEnum('eseal_log_level', ['INFO', 'ERROR']);

export const bsreTotpKindEnum = pgEnum('bsre_totp_kind', [
  'ACTIVATION',
  'SEAL',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const esealBatches = pgTable(
  'eseal_batches',
  {
    id: char('id', { length: 26 })
      .$defaultFn(() => ulid())
      .primaryKey(),

    userId: varchar('user_id', { length: 255 }).notNull(),

    status: esealBatchStatusEnum('status').default('PENDING').notNull(),

    currentStep: esealBatchStepEnum('current_step')
      .default('QUEUED')
      .notNull(),

    sealConfig: jsonb('seal_config').$type<SealConfig>().notNull(),

    error: text('error'),

    startedAt: timestamp('started_at', { withTimezone: true }),

    finishedAt: timestamp('finished_at', { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    index('eseal_batches_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const esealFiles = pgTable(
  'eseal_files',
  {
    id: char('id', { length: 26 })
      .$defaultFn(() => ulid())
      .primaryKey(),

    batchId: char('batch_id', { length: 26 })
      .notNull()
      .references(() => esealBatches.id, { onDelete: 'cascade' }),

    position: smallint('position').notNull(),

    originalFilename: varchar('original_filename', { length: 255 }).notNull(),

    fileSize: bigint('file_size', { mode: 'number' }).notNull(),

    rawPath: text('raw_path').notNull(),

    verifiedPath: text('verified_path'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('eseal_files_batch_id_position_idx').on(
      table.batchId,
      table.position,
    ),
  ],
);

export const esealLogs = pgTable(
  'eseal_logs',
  {
    id: char('id', { length: 26 })
      .$defaultFn(() => ulid())
      .primaryKey(),

    batchId: char('batch_id', { length: 26 })
      .notNull()
      .references(() => esealBatches.id, { onDelete: 'cascade' }),

    level: esealLogLevelEnum('level').notNull(),

    step: esealBatchStepEnum('step').notNull(),

    message: text('message').notNull(),

    meta: jsonb('meta').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('eseal_logs_batch_id_created_at_idx').on(
      table.batchId,
      table.createdAt,
    ),
  ],
);

export const bsreTotp = pgTable('bsre_totp', {
  kind: bsreTotpKindEnum('kind').primaryKey(),

  totp: varchar('totp', { length: 10 }).notNull(),

  idSubscriber: varchar('id_subscriber', { length: 100 }),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const esealRelations = defineRelations(
  { esealBatches, esealFiles, esealLogs },
  (r) => ({
    esealBatches: {
      files: r.many.esealFiles({
        from: r.esealBatches.id,
        to: r.esealFiles.batchId,
      }),
      logs: r.many.esealLogs({
        from: r.esealBatches.id,
        to: r.esealLogs.batchId,
      }),
    },
    esealFiles: {
      batch: r.one.esealBatches({
        from: r.esealFiles.batchId,
        to: r.esealBatches.id,
      }),
    },
    esealLogs: {
      batch: r.one.esealBatches({
        from: r.esealLogs.batchId,
        to: r.esealBatches.id,
      }),
    },
  }),
);
