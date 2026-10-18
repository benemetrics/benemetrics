import { db } from "../index.ts";
import { experimentMetrics } from "../schema/experiment-metrics.ts";
import { eq, and, desc, count } from "drizzle-orm";
import { crypto } from "../../backend/utils/crypto.ts";

export const experimentMetricDAO = {
  async record(data: {
    flagId: string;
    variantKey: string;
    userId: string;
    metricName: string;
    value?: number;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(experimentMetrics)
      .values({
        id,
        flagId: data.flagId,
        variantKey: data.variantKey,
        userId: data.userId,
        metricName: data.metricName,
        value: data.value ?? 1,
        recordedAt: now,
      })
      .returning();

    return result[0];
  },

  async countByVariant(flagId: string, metricName: string) {
    const result = await db
      .select({ variantKey: experimentMetrics.variantKey, count: count() })
      .from(experimentMetrics)
      .where(and(eq(experimentMetrics.flagId, flagId), eq(experimentMetrics.metricName, metricName)))
      .groupBy(experimentMetrics.variantKey);
    return result;
  },
};