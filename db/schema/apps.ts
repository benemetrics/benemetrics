import { pgTable, text, serial, uuid, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";
import { projects } from "./project";

export const apps = pgTable(
  "apps",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    number: serial("number").notNull().unique(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    publicKey: text("public_key").notNull().unique(),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (t) => [index().on(t.projectId)],
);

export const appPublicFields = {
  id: apps.id,
  name: apps.name,
  number: apps.number,
  projectId: apps.projectId,
  platform: apps.platform,
  publicKey: apps.publicKey,
  updatedAt: apps.updatedAt,
};

export type AppRecord = typeof apps.$inferSelect;
export type AppInsert = typeof apps.$inferInsert;
