import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

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
    latestEventId: text("latest_event_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    appIdIdx: index("issues_app_id_idx").on(table.appId),
    statusIdx: index("issues_status_idx").on(table.status),
    appFingerprintUnique: uniqueIndex("issues_app_fingerprint_unique").on(table.appId, table.fingerprint),
  }),
);

export type Issue = typeof issues.$inferSelect;
export type IssueInsert = typeof issues.$inferInsert;