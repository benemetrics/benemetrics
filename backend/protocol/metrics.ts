export interface MetricSeriesRequest {
  metric: string;
  projectId?: string;
  environmentId?: string;
  appId?: string;
  from: string;
  to: string;
  stepSeconds?: number;
}

export interface MetricSeriesPoint {
  bucketStart: string;
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricSeriesResponse {
  metric: string;
  unit: string;
  points: MetricSeriesPoint[];
}

export interface MetricBreakdownRequest {
  metric: string;
  projectId?: string;
  environmentId?: string;
  appId?: string;
  from: string;
  to: string;
  limit?: number;
}

export interface MetricBreakdownResponse {
  data: Array<{
    dimension: string;
    count: number;
    mean: number;
    p50: number;
    p95: number;
  }>;
}

export interface MetricSample {
  eventId: string;
  projectId: string;
  appId: string;
  metric: string;
  value: number;
  dimension: string;
  timestamp: string;
}