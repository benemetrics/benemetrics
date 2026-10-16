import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

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
    status: text("status").notNull().default("unresolved"),
    eventCount: integer("event_count").notNull().default(1),
    firstSeen: text("first_seen").notNull(),
    lastSeen: text("last_seen").notNull(),
    // Stored event id of the most recent occurrence; the UI drills into it.
    latestEventId: text("latest_event_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    appIdIdx: index("issues_app_id_idx").on(table.appId),
    statusIdx: index("issues_status_idx").on(table.status),
    appFingerprintUnique: uniqueIndex("issues_app_fingerprint_idx").on(
      table.appId,
      table.fingerprint,
    ),
  }),
);

export type IssueRow = typeof issues.$inferSelect;
export type IssueInsert = typeof issues.$inferInsert;
