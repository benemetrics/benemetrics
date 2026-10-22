import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { eq, sql } from "drizzle-orm";
import { isoTimestamp } from "./timestamps";

// Environments belong to a project and are shared by all
// of its apps. An app is created inside an environment
// (apps.environment_id); the same environment serves every
// app that lives in it.
export const environments = pgTable("environments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
  updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  projectIdIdx: index("environments_project_id_idx").on(table.projectId),
  projectSlugUnique: uniqueIndex("environments_project_slug_idx").on(table.projectId, table.slug),
  // Business rule: exactly one default environment per project,
  // enforced by the database (partial unique index).
  oneDefaultPerProject: uniqueIndex("environments_one_default_idx")
    .on(table.projectId)
    .where(eq(table.isDefault, 1)),
}));

export type Environment = typeof environments.$inferSelect;
export type EnvironmentInsert = typeof environments.$inferInsert;
