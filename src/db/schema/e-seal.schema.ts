import { integer, pgTable, varchar } from 'drizzle-orm/pg-core';

export const usersTable = pgTable('seal_jobs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar().notNull(),
  age: integer().notNull(),
  email: varchar().notNull().unique(),
});
