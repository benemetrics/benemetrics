import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const environments = pgTable(
  "environments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectIdIdx: index("environments_project_id_idx").on(table.projectId),
    projectSlugUnique: uniqueIndex("environments_project_slug_unique").on(table.projectId, table.slug),
    projectDefaultUnique: uniqueIndex("environments_project_default_unique").on(table.projectId).where(table.isDefault.eq(1)),
  }),
);

export type Environment = typeof environments.$inferSelect;
export type EnvironmentInsert = typeof environments.$inferInsert;