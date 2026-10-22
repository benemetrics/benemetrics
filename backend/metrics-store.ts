import type { MetricBreakdownRow, MetricSeriesPoint } from "./protocol/metrics";
import {
  countClickHouseMetricSamples,
  countClickHouseMetricSamplesByProject,
  listMetricBreakdown,
  listMetricSeries,
  quantileClickHouseMetricSamples,
  quantileClickHouseMetricSamplesByProject,
  type MetricReadFilter,
} from "./clickhouse";

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

export async function countMetricSamples(
  appId: string,
  metric: string,
  since: string,
  tags?: Record<string, string>,
  until?: string,
): Promise<number> {
  return countClickHouseMetricSamples({ appId, metric, since, until, tags });
}

export async function countProjectMetricSamples(
  projectId: string,
  metric: string,
  since: string,
  tags?: Record<string, string>,
  until?: string,
): Promise<number> {
  return countClickHouseMetricSamplesByProject({ projectId, metric, since, until, tags });
}

export async function projectMetricSampleQuantile(
  projectId: string,
  metric: string,
  quantile: number,
  since: string,
  tags?: Record<string, string>,
  until?: string,
): Promise<number> {
  return quantileClickHouseMetricSamplesByProject({
    projectId,
    metric,
    quantile,
    since,
    until,
    tags,
  });
}

export async function metricSampleQuantile(
  appId: string,
  metric: string,
  quantile: number,
  since: string,
  tags?: Record<string, string>,
  until?: string,
): Promise<number> {
  return quantileClickHouseMetricSamples({ appId, metric, quantile, since, until, tags });
}
