import { db } from "db";
import { experimentMetrics } from "db/schema/experiment-metrics";
import { countDistinct, eq, and } from "drizzle-orm";
import type { PgInsertValue } from "drizzle-orm/pg-core";
import { internalError } from "backend/errors";

type MetricRow = typeof experimentMetrics.$inferSelect;

export interface MetricRecord {
  id: string;
  flagId: string;
  variantKey: string;
  userId: string;
  metricName: string;
  value: number;
  recordedAt: string;
}

export interface VariantCount {
  variantKey: string;
  count: number;
}

export const experimentMetricDAO = {
  record: async (
    data: Omit<PgInsertValue<typeof experimentMetrics>, "id" | "recordedAt"> & {
      id?: string;
      recordedAt?: string;
    },
  ): Promise<MetricRecord> => {
    const [row] = await db
      .insert(experimentMetrics)
      .values({
        ...data,
        id: data.id ?? crypto.randomUUID(),
        recordedAt: data.recordedAt ?? new Date().toISOString(),
      })
      .returning();
    if (!row) {
      throw internalError("Failed to record experiment metric");
    }
    return row;
  },

  countByVariant: async (
    flagId: string,
    metricName: string,
  ): Promise<VariantCount[]> => {
    const rows = await db
      .select({
        variantKey: experimentMetrics.variantKey,
        count: countDistinct(experimentMetrics.userId),
      })
      .from(experimentMetrics)
      .where(
        and(
          eq(experimentMetrics.flagId, flagId),
          eq(experimentMetrics.metricName, metricName),
        ),
      )
      .groupBy(experimentMetrics.variantKey);
    return rows;
  },
};
