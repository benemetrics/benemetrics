// One metric sample as it travels on `sentry.metrics` (JSONEachRow) and
// lands in ClickHouse: one row per (event, metric, dimension).
export interface MetricSample {
  projectId: string;
  /** App the event was ingested through. */
  appId: string;
  eventId: string;
  metric: string;
  /** Numeric measurement or sentinel value; always finite. */
  value: number;
  /** Transaction name (route/screen) when known, "" otherwise. */
  dimension: string;
  /** Received-at of the envelope the sample was extracted from. */
  receivedAt: string;
}

/** What the numbers of a metric mean (display metadata for clients). */
export type MetricUnit = "millisecond" | "ratio" | "count" | "none";

/** One time bucket of a metric series (`GET /api/admin/metrics/series`). */
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

/** One dimension row of a metric breakdown (`.../metrics/breakdown`). */
export interface MetricBreakdownRow {
  dimension: string;
  count: number;
  mean: number;
  p50: number;
  p95: number;
}

export interface MetricBreakdown {
  data: MetricBreakdownRow[];
}
