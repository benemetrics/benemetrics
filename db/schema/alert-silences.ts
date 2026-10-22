import { pgTable, text, index } from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";

// A silence: while it is active the rules in its scope do not fire.
// The scope is global, a project or an app — the alerting model has no
// environment scope.
export const alertSilences = pgTable(
  "alert_silences",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // "global" | "project" | "app"; the app/project id is in scopeId.
    scopeType: text("scope_type").notNull().default("global"),
    scopeId: text("scope_id"),
    startsAt: isoTimestamp("starts_at").notNull(),
    // A silence without an end is open-ended.
    endsAt: isoTimestamp("ends_at"),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: isoTimestamp("created_at").notNull(),
    updatedAt: isoTimestamp("updated_at").notNull(),
  },
  (table) => ({
    scopeIdx: index("alert_silences_scope_idx").on(table.scopeType, table.scopeId),
  }),
);

export type AlertSilenceRow = typeof alertSilences.$inferSelect;
export type AlertSilenceInsert = typeof alertSilences.$inferInsert;
