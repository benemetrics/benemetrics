import { pgTable, text, index } from "drizzle-orm/pg-core";

export const segments = pgTable(
  "segments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").default(""),
    rules: text("rules").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    nameIdx: index("segments_name_idx").on(table.name),
  }),
);

export type Segment = typeof segments.$inferSelect;
export type SegmentInsert = typeof segments.$inferInsert;