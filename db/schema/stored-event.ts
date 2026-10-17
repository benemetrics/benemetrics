import {
  pgTable,
  text,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

export const storedEvents = pgTable("stored_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  appId: text("app_id"),
  envelopeHeader: text("envelope_header").notNull(),
  envelopeItems: text("envelope_items").notNull(),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectIdIdx: index("stored_events_project_id_idx").on(table.projectId),
  appIdIdx: index("stored_events_app_id_idx").on(table.appId),
  receivedAtIdx: index("stored_events_received_at_idx").on(table.receivedAt),
}));

export type StoredEvent = typeof storedEvents.$inferSelect;
export type StoredEventInsert = typeof storedEvents.$inferInsert;