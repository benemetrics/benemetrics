import {
  pgTable,
  text,
  real,
  index,
} from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";

export const experimentMetrics = pgTable(
  "experiment_metrics",
  {
    id: text("id").primaryKey(),
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
