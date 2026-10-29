import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

export const projects = pgTable("projects", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  createdAt: isoTimestamp("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: isoTimestamp("updated_at")
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => sql`now()`),
});

export const projectPublicFields = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

export type Project = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
