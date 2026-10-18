import { pgTable, text, integer, serial, index, uniqueIndex } from "drizzle-orm/pg-core";

export const apps = pgTable(
  "apps",
  {
    id: text("id").primaryKey(),
    number: serial("number").notNull().unique(),
    projectId: text("project_id").notNull(),
    environmentId: text("environment_id").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull().default("javascript"),
    ingestKey: text("ingest_key").notNull(),
    publicKey: text("public_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectIdIdx: index("apps_project_id_idx").on(table.projectId),
    environmentIdIdx: index("apps_environment_id_idx").on(table.environmentId),
    projectNumberUnique: uniqueIndex("apps_project_number_unique").on(table.projectId, table.number),
    ingestKeyUnique: uniqueIndex("apps_ingest_key_unique").on(table.ingestKey),
    publicKeyUnique: uniqueIndex("apps_public_key_unique").on(table.publicKey),
  }),
);

export type App = typeof apps.$inferSelect;
export type AppInsert = typeof apps.$inferInsert;