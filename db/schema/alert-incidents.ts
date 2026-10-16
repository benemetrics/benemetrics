import { pgTable, text, real, index } from "drizzle-orm/pg-core";

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
    triggeredAt: text("triggered_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => ({
    ruleIdIdx: index("alert_incidents_rule_id_idx").on(table.ruleId),
    appIdIdx: index("alert_incidents_app_id_idx").on(table.appId),
    statusIdx: index("alert_incidents_status_idx").on(table.status),
  }),
);

export type AlertIncidentRow = typeof alertIncidents.$inferSelect;
export type AlertIncidentInsert = typeof alertIncidents.$inferInsert;
