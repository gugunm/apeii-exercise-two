import {
  pgTable,
  char,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ulid } from 'ulid';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const apiKeys = pgTable(
  'api_keys',
  {
    id: char('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    name: varchar('name', { length: 255 }).notNull(),
    keyHash: char('key_hash', { length: 64 }).notNull(),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('api_keys_key_hash_idx').on(t.keyHash)],
);
