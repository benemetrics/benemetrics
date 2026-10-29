import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// One row per error issue of an app, identified by (app_id, fingerprint).
// `status` flips to "resolved" through the admin API and back to
// "unresolved" when a new event arrives for the issue — that
// unresolved-after-resolved transition is the regression the
// "regression" alert trigger fires on.
export const issues = pgTable(
  "issues",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    // The presentation fields of the latest occurrence (latest-writer-wins).
    culprit: text("culprit"),
    level: text("level").notNull().default("error"),
    type: text("type").notNull().default("message"),
    firstRelease: text("first_release"),
    lastRelease: text("last_release"),
    // The tags of the latest occurrence — the dimensions an alert rule
    // filters on.
    tags: text("tags").notNull().default("{}"),
    status: text("status").notNull().default("unresolved"),
    eventCount: integer("event_count").notNull().default(1),
    // The distinct-user count, synced from the ClickHouse issue index when a
    // `sort=users` read happens (never incremented; the sync is idempotent).
    userCount: integer("user_count").notNull().default(0),
    firstSeen: isoTimestamp("first_seen").notNull(),
    lastSeen: isoTimestamp("last_seen").notNull(),
    // Stored event id of the most recent occurrence; the UI drills into it.
    latestEventId: text("latest_event_id"),
    createdAt: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => ({
    appIdIdx: index("issues_app_id_idx").on(table.appId),
    statusIdx: index("issues_status_idx").on(table.status),
    // Supports the default "new" sort: WHERE status = ? ORDER BY last_seen DESC, id DESC
    // (PostgreSQL can scan this index backward, so no sort and no full table scan.)
    statusLastSeenIdIdx: index("issues_status_last_seen_id_idx").on(
      table.status,
      table.lastSeen,
      table.id,
    ),
    appFingerprintUnique: uniqueIndex("issues_app_fingerprint_idx").on(
      table.appId,
      table.fingerprint,
    ),
  }),
);

export type IssueRow = typeof issues.$inferSelect;
export type IssueInsert = typeof issues.$inferInsert;
