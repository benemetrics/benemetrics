import { api } from './api.ts';
import { formatMs } from './utils.ts';

// The metrics API client: samples live in ClickHouse and are served as
// bucketed series and per-dimension breakdowns. Units and rating bands
// mirror the backend taxonomy (backend/metrics/samples.ts and
// backend/metrics/index.ts) so every panel agrees on what a number means.

export interface MetricSeriesPoint {
  bucketStart: string;
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricSeries {
  metric: string;
  unit: MetricUnit;
  points: MetricSeriesPoint[];
}

export interface MetricBreakdownRow {
  dimension: string;
  count: number;
  mean: number;
  p50: number;
  p95: number;
}

export interface MetricScope {
  projectId?: string;
  environmentId?: string;
  appId?: string;
}

export interface MetricQuery extends MetricScope {
  metric: string;
  from: string;
  to: string;
  stepSeconds?: number;
  limit?: number;
}

// Eden serializes `undefined` values as the literal string "undefined",
// so only defined params are sent.
function metricQuery(params: MetricQuery): Record<string, string | number> {
  const query: Record<string, string | number> = {
    metric: params.metric,
    from: params.from,
    to: params.to,
  };
  if (params.projectId) query.projectId = params.projectId;
  if (params.environmentId) query.environmentId = params.environmentId;
  if (params.appId) query.appId = params.appId;
  if (params.stepSeconds) query.stepSeconds = params.stepSeconds;
  if (params.limit) query.limit = params.limit;
  return query;
}

export async function fetchMetricSeries(params: MetricQuery): Promise<MetricSeries> {
  const response = await api.api.admin.metrics.series.get({ $query: metricQuery(params) });
  if (!response?.data) throw new Error('metrics series unavailable');
  return response.data as MetricSeries;
}

export async function fetchMetricBreakdown(params: MetricQuery): Promise<MetricBreakdownRow[]> {
  const response = await api.api.admin.metrics.breakdown.get({ $query: metricQuery(params) });
  if (!response?.data) throw new Error('metrics breakdown unavailable');
  return (response.data as { data: MetricBreakdownRow[] }).data;
}

// One bucket over the whole window: the exact count and quantiles for the
// window. Quantiles do not aggregate across buckets, so panels that
// summarize a whole window ask for a single bucket instead of combining
// per-bucket values.
export async function fetchMetricSummary(
  params: MetricQuery & { windowSeconds: number },
): Promise<MetricSeriesPoint | null> {
  const series = await fetchMetricSeries({ ...params, stepSeconds: params.windowSeconds });
  return series.points[0] ?? null;
}

export type MetricUnit = 'millisecond' | 'ratio' | 'count' | 'none';

// The unit taxonomy the ingestion extractor writes (backend/metrics).
// Custom measurements are unitless.
const METRIC_UNITS: Record<string, MetricUnit> = {
  lcp: 'millisecond',
  inp: 'millisecond',
  cls: 'ratio',
  fcp: 'millisecond',
  ttfb: 'millisecond',
  'ttfb.requesttime': 'millisecond',
  fp: 'millisecond',
  fid: 'millisecond',
  app_start_cold: 'millisecond',
  app_start_warm: 'millisecond',
  time_to_initial_display: 'millisecond',
  time_to_full_display: 'millisecond',
  stall_total_time: 'millisecond',
  stall_longest_time: 'millisecond',
  stall_count: 'count',
  frames_total: 'count',
  frames_slow: 'count',
  frames_frozen: 'count',
  frames_slow_rate: 'ratio',
  frames_frozen_rate: 'ratio',
  stall_percentage: 'ratio',
  event_count: 'count',
  error_count: 'count',
  fatal_count: 'count',
  duration: 'millisecond',
};

export function metricUnit(metric: string): MetricUnit {
  return METRIC_UNITS[metric] ?? 'none';
}

export function formatMetricValue(value: number, unit: MetricUnit): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'millisecond') return formatMs(value);
  if (unit === 'count') return `${Math.round(value)}`;
  return value < 1 ? value.toFixed(3) : value.toFixed(2);
}

export interface MetricBand {
  good: number;
  improvement: number;
}

export type MetricRating = 'good' | 'improvement' | 'poor';

export function rateMetric(value: number, band: MetricBand): MetricRating {
  if (value <= band.good) return 'good';
  if (value <= band.improvement) return 'improvement';
  return 'poor';
}

export interface MetricDefinition {
  metric: string;
  label: string;
  band: MetricBand;
}

// Web vitals thresholds, mirroring the taxonomy in the plan: lcp
// 2500/4000, inp 200/500, cls 0.1/0.25, fcp 1800/3000, ttfb 800/1800,
// fp 1000/3000, fid 100/300.
export const WEB_VITALS: MetricDefinition[] = [
  { metric: 'lcp', label: 'LCP', band: { good: 2500, improvement: 4000 } },
  { metric: 'inp', label: 'INP', band: { good: 200, improvement: 500 } },
  { metric: 'cls', label: 'CLS', band: { good: 0.1, improvement: 0.25 } },
  { metric: 'fcp', label: 'FCP', band: { good: 1800, improvement: 3000 } },
  { metric: 'ttfb', label: 'TTFB', band: { good: 800, improvement: 1800 } },
  { metric: 'fp', label: 'FP', band: { good: 1000, improvement: 3000 } },
  { metric: 'fid', label: 'FID', band: { good: 100, improvement: 300 } },
];

// Mobile vitals with defined thresholds: cold start <3s/<5s, warm start
// <1s/<2s.
export const MOBILE_STARTS: MetricDefinition[] = [
  { metric: 'app_start_cold', label: 'Cold start', band: { good: 3000, improvement: 5000 } },
  { metric: 'app_start_warm', label: 'Warm start', band: { good: 1000, improvement: 2000 } },
];

// Mobile measurements displayed without a rating band.
export const MOBILE_MEASUREMENTS: Array<{ metric: string; label: string }> = [
  { metric: 'time_to_initial_display', label: 'Time to initial display' },
  { metric: 'time_to_full_display', label: 'Time to full display' },
];
