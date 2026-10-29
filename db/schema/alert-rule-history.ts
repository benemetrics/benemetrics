import { pgTable, text, index, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// The history of an alert rule: every change is recorded with the actor
// and the state before/after, so a rule's evolution is auditable.
export const alertRuleHistory = pgTable(
  "alert_rule_history",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    ruleId: text("rule_id").notNull(),
    name: text("name").notNull(),
    // "created" | "updated" | "deleted"
    action: text("action").notNull(),
    // The rule as it was after the change; a JSON object.
    snapshot: text("snapshot").notNull(),
    actor: text("actor"),
    createdAt: isoTimestamp("created_at").notNull(),
  },
  (table) => ({
    ruleIdx: index("alert_rule_history_rule_id_idx").on(table.ruleId),
  }),
);

export type AlertRuleHistoryRow = typeof alertRuleHistory.$inferSelect;
export type AlertRuleHistoryInsert = typeof alertRuleHistory.$inferInsert;
