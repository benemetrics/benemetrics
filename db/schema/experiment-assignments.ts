import {
  pgTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";

export const experimentAssignments = pgTable(
  "experiment_assignments",
  {
    id: text("id").primaryKey(),
    flagId: text("flag_id").notNull(),
    userId: text("user_id").notNull(),
    variantKey: text("variant_key").notNull(),
    context: text("context").notNull().default("{}"),
    assignedAt: isoTimestamp("assigned_at").notNull(),
  },
  (table) => ({
    flagUserUnique: uniqueIndex("experiment_assignments_flag_user_idx").on(
      table.flagId,
      table.userId,
    ),
    flagIdx: index("experiment_assignments_flag_idx").on(table.flagId),
  }),
);

export type ExperimentAssignment = typeof experimentAssignments.$inferSelect;
