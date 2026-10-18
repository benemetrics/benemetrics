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
