import { pgTable, text, index, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

export const experimentAssignments = pgTable(
  "experiment_assignments",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    flagId: text("flag_id").notNull(),
    userId: text("user_id").notNull(),
    variantKey: text("variant_key").notNull(),
    context: text("context").notNull().default("{}"),
    assignedAt: isoTimestamp("assigned_at").notNull(),
  },
  (table) => ({
    flagUserUnique: uniqueIndex().on(
      table.flagId,
      table.userId,
    ),
    flagIdx: index().on(table.flagId),
  }),
);

export type ExperimentAssignment = typeof experimentAssignments.$inferSelect;
