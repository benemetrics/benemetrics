import type { ParsedEnvelope } from "../events/utils";
import { normalizeTransactionPayload } from "../events/utils";
import type { MetricSample } from "../protocol/metrics";

// Ingestion-time sample extraction: the API already parses the envelope,
// so it lifts every metric out of it and publishes them next to the event
// — no consumer ever re-parses a payload to build series (SQL-side
// extraction was rejected: it would duplicate this taxonomy in
// ClickHouse SQL).
//
// Every numeric measurement is kept — no allowlist — including custom
// measurements and the rate samples React Native sends; `dimension` is
// the transaction name (route/screen), "" when the event has none.
// Sentinels are added on top: `event_count` per stored event,
// `error_count`/`fatal_count` for error events and `duration` (ms) for
// transactions.

type ParsedItem = ParsedEnvelope["items"][number];

function toRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

/** Transaction name used as the sample dimension. */
function dimensionOf(record: Record<string, unknown>): string {
  return typeof record.transaction === "string" ? record.transaction : "";
}

/** Sentry timestamps are seconds since epoch, number or string. */
function toSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function extractMetricSamples(input: {
  projectId: string;
  appId: string;
  eventId: string;
  /** Converted envelope items (spans already folded into transactions). */
  items: ParsedItem[];
  receivedAt: string;
}): MetricSample[] {
  const { projectId, appId, eventId, items, receivedAt } = input;
  const samples: MetricSample[] = [];
  const add = (metric: string, value: number, dimension: string) => {
    if (!Number.isFinite(value)) return;
    samples.push({ projectId, appId, eventId, metric, value, dimension, receivedAt });
  };

  for (const item of items) {
    if (item.header.type !== "event" && item.header.type !== "transaction") {
      continue;
    }
    const record = toRecord(normalizeTransactionPayload(item.payload));
    const dimension = dimensionOf(record);

    add("event_count", 1, dimension);
    if (item.header.type === "event") {
      add("error_count", 1, dimension);
      if (record.level === "fatal") add("fatal_count", 1, dimension);
      continue;
    }

    const start = toSeconds(record.start_timestamp);
    const end = toSeconds(record.timestamp);
    if (start !== null && end !== null && end >= start) {
      add("duration", (end - start) * 1000, dimension);
    }

    const measurements = record.measurements;
    if (!measurements || typeof measurements !== "object") continue;
    for (const [name, entry] of Object.entries(measurements as Record<string, unknown>)) {
      const value =
        entry && typeof entry === "object"
          ? (entry as { value?: unknown }).value
          : entry;
      if (typeof value === "number" && Number.isFinite(value)) {
        add(name, value, dimension);
      }
    }
  }

  return samples;
}
