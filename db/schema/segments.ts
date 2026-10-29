import { pgTable, text, index, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

export const segments = pgTable("segments", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  rules: text("rules").notNull().default("[]"),
  createdAt: isoTimestamp("created_at")
    .notNull()
    .default(sql`now()`),
});

export type Segment = typeof segments.$inferSelect;
