import {
  pgTable,
  text,
  index,
  serial,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

export const projects = pgTable("projects", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
  updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
});

export const apps = pgTable("apps", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  number: serial("number").notNull().unique(),
  projectId: uuid("project_id").references(() => projects.id),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("javascript"),
  publicKey: text("public_key").notNull().unique(),
  createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
  updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
});

export type Project = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
export type AppRecord = typeof apps.$inferSelect;
export type AppInsert = typeof apps.$inferInsert;