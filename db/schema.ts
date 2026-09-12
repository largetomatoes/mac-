import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const notebooks = sqliteTable('notebooks', { id: text('id').primaryKey(), version: integer('version').notNull().default(0), content: text('content').notNull() });
