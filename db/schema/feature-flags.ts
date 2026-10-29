import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").default(""),
    type: text("type").notNull(),
    defaultValue: text("default_value").notNull(),
    variants: text("variants").notNull().default("[]"),
    targetingRules: text("targeting_rules").notNull().default("[]"),
    segments: text("segments").notNull().default("[]"),
    status: text("status").notNull().default("draft"),
    // The scope: a project, optionally narrowed to one of its apps. The
    // key is unique per scope, so the same key can exist in two projects.
    projectId: text("project_id"),
    appId: text("app_id"),
    rolloutPercentage: integer("rollout_percentage").notNull().default(100),
    experiment: text("experiment"),
    createdAt: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => ({
    keyIdx: index("feature_flags_key_idx").on(table.key),
    statusIdx: index("feature_flags_status_idx").on(table.status),
    scopeKeyUnique: uniqueIndex("feature_flags_scope_key_idx").on(
      sql`coalesce(${table.projectId}, '')`,
      sql`coalesce(${table.appId}, '')`,
      table.key,
    ),
  }),
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
