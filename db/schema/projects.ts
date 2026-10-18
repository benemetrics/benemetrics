import { pgTable, text, index } from "drizzle-orm/pg-core";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    slugIdx: index("projects_slug_idx").on(table.slug),
  }),
);

export type Project = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;