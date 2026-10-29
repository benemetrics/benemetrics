import { pgTable, text, real, index, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

export const experimentMetrics = pgTable(
  "experiment_metrics",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    flagId: text("flag_id").notNull(),
    variantKey: text("variant_key").notNull(),
    userId: text("user_id").notNull(),
    metricName: text("metric_name").notNull(),
    value: real("value").notNull().default(1),
    recordedAt: isoTimestamp("recorded_at").notNull(),
  },
  (table) => ({
    flagMetricIdx: index("experiment_metrics_flag_metric_idx").on(
      table.flagId,
      table.metricName,
    ),
  }),
);

export type ExperimentMetric = typeof experimentMetrics.$inferSelect;
