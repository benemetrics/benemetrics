import type { MetricBreakdownRow, MetricSeriesPoint } from "./protocol/metrics";
import {
  countClickHouseMetricSamples,
  listMetricBreakdown,
  listMetricSeries,
  quantileClickHouseMetricSamples,
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

// Alert-sweeper reads: sentinel counts and measurement quantiles over the
// app's samples in the window.
export async function countMetricSamples(
  appId: string,
  metric: string,
  since: string,
): Promise<number> {
  return countClickHouseMetricSamples({ appId, metric, since });
}

export async function metricSampleQuantile(
  appId: string,
  metric: string,
  quantile: number,
  since: string,
): Promise<number> {
  return quantileClickHouseMetricSamples({ appId, metric, quantile, since });
}
