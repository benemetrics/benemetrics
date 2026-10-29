import { db } from "db";
import { experimentMetrics } from "db/schema/experiment-metrics";
import { count, eq, and } from "drizzle-orm";
import type { PgInsertValue } from "drizzle-orm/pg-core";

export interface VariantCount {
  variantKey: string;
  count: number;
}

export const experimentMetricDAO = {
  // Tracking is fire-and-forget: the route only needs the write to succeed.
  record: (
    data: Omit<PgInsertValue<typeof experimentMetrics>, "id" | "recordedAt"> & {
      id?: string;
      recordedAt?: string;
    },
  ): Promise<void> =>
    db.insert(experimentMetrics).values({
      ...data,
      recordedAt: data.recordedAt ?? new Date().toISOString(),
    }),

  // Conversions are metric rows, not distinct users: a user who records
  // the primary metric twice counts twice.
  countByVariant: (
    flagId: string,
    metricName: string,
  ): Promise<VariantCount[]> =>
    db
      .select({
        variantKey: experimentMetrics.variantKey,
        count: count(),
      })
      .from(experimentMetrics)
      .where(
        and(
          eq(experimentMetrics.flagId, flagId),
          eq(experimentMetrics.metricName, metricName),
        ),
      )
      .groupBy(experimentMetrics.variantKey),
};
