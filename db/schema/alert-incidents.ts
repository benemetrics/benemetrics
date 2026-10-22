import { pgTable, text, real, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// An incident is "firing"
// while its rule's metric breaches the threshold and
// "resolved" once the metric recovers.
//
// Issue triggers (new_issue / regression) are one-shot: their incidents
// are recorded already resolved (nothing to recover) and carry the
// issue `fingerprint` so the per-issue cooldown can be enforced.
export const alertIncidents = pgTable(
  "alert_incidents",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    appId: text("app_id"),
    trigger: text("trigger").notNull().default("threshold"),
    issueFingerprint: text("issue_fingerprint"),
    metric: text("metric"),
    value: real("value"),
    threshold: real("threshold"),
    status: text("status").notNull().default("firing"),
    triggeredAt: isoTimestamp("triggered_at").notNull(),
    resolvedAt: isoTimestamp("resolved_at"),
    // The acknowledgment: who took the incident and when.
    acknowledgedAt: isoTimestamp("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
    // The assignee (free text — the backend has no member directory).
    assignee: text("assignee"),
  },
  (table) => ({
    ruleIdIdx: index("alert_incidents_rule_id_idx").on(table.ruleId),
    appIdIdx: index("alert_incidents_app_id_idx").on(table.appId),
    statusIdx: index("alert_incidents_status_idx").on(table.status),
    triggerCheck: check(
      "alert_incidents_trigger_check",
      sql`${table.trigger} in ('threshold', 'new_issue', 'regression')`,
    ),
    statusCheck: check(
      "alert_incidents_status_check",
      sql`${table.status} in ('firing', 'resolved')`,
    ),
  }),
);

export type AlertIncidentRow = typeof alertIncidents.$inferSelect;
export type AlertIncidentInsert = typeof alertIncidents.$inferInsert;
