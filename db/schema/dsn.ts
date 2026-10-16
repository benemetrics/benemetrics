import {
  pgTable,
  text,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

export const dsnRecords = pgTable("dsn_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  host: text("host").notNull().default("localhost"),
  protocol: text("protocol").notNull().default("https"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectIdIdx: index("dsn_records_project_id_idx").on(table.projectId),
}));

export type DsnRecord = typeof dsnRecords.$inferSelect;
export type DsnRecordInsert = typeof dsnRecords.$inferInsert;