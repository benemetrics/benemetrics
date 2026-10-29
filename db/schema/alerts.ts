import {
  pgTable,
  text,
  integer,
  real,
  check,
  index,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";
import { apps } from "./apps";
import { projects } from "./project";

// The scope: app_id set = the app scope; project_id set (and app_id
// null) = the project scope; both null = the global scope. A narrower
// channel with the same name replaces the wider one.
export const alertChannels = pgTable(
  "alert_channels",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config").notNull().default("{}"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    index().on(table.projectId)
  ]
);


export type AlertChannelRow = typeof alertChannels.$inferSelect;
export type AlertChannelInsert = typeof alertChannels.$inferInsert;

// The scope: app_id set = the app scope; project_id set (and app_id
// null) = the project scope; both null = the global scope. A narrower rule
// with the same name replaces the wider one.
//
// `trigger` selects what fires the rule:
//   - "threshold": the metric/operator/threshold/window fields define a
//     windowed metric breach (evaluated by the sweeper).
//   - "new_issue" / "regression": fired from ingestion when an issue
//     appears for the first time / reopens after being resolved; the
//     threshold fields are null.
export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    trigger: text("trigger").notNull().default("threshold"),
    metric: text("metric"),
    operator: text("operator"),
    threshold: real("threshold"),
    // A dynamic threshold ("3x baseline"): when set, the rule compares the
    // windowed value against `threshold_factor × baseline` instead of the
    // static threshold; the baseline is the per-window average of the same
    // metric over the history preceding the evaluation window.
    thresholdFactor: real("threshold_factor"),
    // The folder groups the rules in the admin UI; null is the ungrouped. ?????
    folder: text("folder"),
    windowSeconds: integer("window_seconds"),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(3600),
    measurement: text("measurement"),
    appId: uuid("app_id").references(() => apps.id, { onDelete: 'cascade' }),
    // The dimensions the rule matches on (the tags); a JSON object.
    filters: text("filters").notNull().default("{}"),
    // The message template; null keeps the default message.
    message: text("message"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    lastTriggeredAt: isoTimestamp("last_triggered_at"),
    createdAt: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    index().on(table.appId)
  ],
);

export type AlertRuleRow = typeof alertRules.$inferSelect;
export type AlertRuleInsert = typeof alertRules.$inferInsert;

export const alertRuleChannels = pgTable(
  "alert_rule_channels",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    ruleId: uuid("rule_id").notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
    channelId: uuid("channel_id").notNull().references(() => alertChannels.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index().on(table.ruleId)
  ],
);

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
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    ruleId: uuid("rule_id").notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
    appId: uuid("app_id").notNull().references(() => apps.id, { onDelete: 'cascade' }),
    trigger: text("trigger").notNull().default("threshold"),
    issueFingerprint: text("issue_fingerprint"),
    metric: text("metric"),
    value: real("value"),
    threshold: real("threshold"),
    status: text("status").notNull().default("firing"),
    triggeredAt: isoTimestamp("triggered_at").notNull(),
    resolvedAt: isoTimestamp("resolved_at"),
    // The root cause the incident belongs to: the scope and the metric.
    correlationKey: text("correlation_key"),
    // The first incident of the group; an incident points at it.
    parentId: text("parent_id"),
    // The acknowledgment: who took the incident and when.
    acknowledgedAt: isoTimestamp("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
  },
  (table) => ({
    ruleIdIdx: index().on(table.ruleId),
    appIdIdx: index().on(table.appId),
    statusIdx: index().on(table.status),
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

