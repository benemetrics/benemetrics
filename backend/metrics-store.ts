import type { MetricBreakdownRow, MetricSeriesPoint } from "./protocol/metrics";
import {
  listMetricBreakdown,
  listMetricSeries,
  type MetricReadFilter,
} from "./clickhouse";

// Metric reads are served by ClickHouse only — it is the samples store,
// fed by the NATS metrics engine table. A ClickHouse failure is a failed
// request (5xx), never a fallback: Postgres holds the control plane and
// has no measurements.

export async function queryMetricSeries(
  filters: MetricReadFilter,
  stepSeconds: number,
): Promise<MetricSeriesPoint[]> {
  return listMetricSeries({ ...filters, stepSeconds });
}

export async function queryMetricBreakdown(
  filters: MetricReadFilter,
  limit: number,
): Promise<MetricBreakdownRow[]> {
  return listMetricBreakdown({ ...filters, limit });
}
