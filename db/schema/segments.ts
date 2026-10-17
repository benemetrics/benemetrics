import {
  pgTable,
  text,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

export const segments = pgTable("segments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  rules: text("rules").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  nameIdx: index("segments_name_idx").on(table.name),
}));

export type Segment = typeof segments.$inferSelect;