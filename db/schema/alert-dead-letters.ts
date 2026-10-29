import { pgTable, text, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// A delivery that failed: the channel, the notification that was to be
// sent and the attempt count. The queue retries the rows whose
// `nextAttemptAt` is due; a row that keeps failing stays here.
export const alertDeadLetters = pgTable(
  "alert_dead_letters",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name").notNull(),
    channelType: text("channel_type").notNull(),
    ruleId: text("rule_id"),
    appId: text("app_id"),
    // The notification as it was to be delivered; a JSON object.
    notification: text("notification").notNull(),
    error: text("error").notNull(),
    attempts: integer("attempts").notNull().default(1),
    nextAttemptAt: isoTimestamp("next_attempt_at").notNull(),
    createdAt: isoTimestamp("created_at").notNull(),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => ({
    dueIdx: index("alert_dead_letters_next_attempt_at_idx").on(
      table.nextAttemptAt,
    ),
  }),
);

export type AlertDeadLetterRow = typeof alertDeadLetters.$inferSelect;
export type AlertDeadLetterInsert = typeof alertDeadLetters.$inferInsert;
