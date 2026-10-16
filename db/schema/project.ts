import {
  pgTable,
  text,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  slugIdx: index("projects_slug_idx").on(table.slug),
}));

export const apps = pgTable("apps", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  environmentId: text("environment_id").notNull(),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("javascript"),
  ingestKey: text("ingest_key").notNull().unique(),
  publicKey: text("public_key").notNull(),
  host: text("host").notNull().default("localhost"),
  protocol: text("protocol").notNull().default("https"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectIdIdx: index("apps_project_id_idx").on(table.projectId),
  ingestKeyIdx: index("apps_ingest_key_idx").on(table.ingestKey),
}));

export type Project = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
export type AppRecord = typeof apps.$inferSelect;
export type AppInsert = typeof apps.$inferInsert;