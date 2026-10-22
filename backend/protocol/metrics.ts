export interface MetricSample {
  projectId: string;
  appId: string;
  eventId: string;
  metric: string;
  value: number;
  dimension: string;
  /** The event's tags — the dimensions a rule filter matches on. */
  tags: Record<string, string>;
  receivedAt: string;
}

export type MetricUnit = "millisecond" | "ratio" | "count" | "none";

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

export interface MetricBreakdown {
  data: MetricBreakdownRow[];
}
