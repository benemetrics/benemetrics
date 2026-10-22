import type { ParsedEnvelope } from "../events/utils";
import { normalizeTransactionPayload } from "../events/utils";
import type { MetricSample } from "../protocol/metrics";

type ParsedItem = ParsedEnvelope["items"][number];

function toRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

function dimensionOf(record: Record<string, unknown>): string {
  return typeof record.transaction === "string" ? record.transaction : "";
}

// The tags are the dimensions a rule filter matches on; only string values
// are kept.
function tagsOf(record: Record<string, unknown>): Record<string, string> {
  const raw = record.tags;
  if (!raw || typeof raw !== "object") return {};
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") tags[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") {
      tags[key] = String(value);
    }
  }
  return tags;
}

// Anything outside the known set (including a missing level) counts as an error.
const KNOWN_LEVELS = new Set([
  "fatal",
  "error",
  "warning",
  "info",
  "debug",
]);

function normalizeLevel(record: Record<string, unknown>): string {
  const raw = record.level;
  if (typeof raw !== "string") return "error";
  const level = raw.toLowerCase();
  return KNOWN_LEVELS.has(level) ? level : "error";
}

function toSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// A measurement may arrive as a numeric string; it is still a measurement.
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function extractMetricSamples(input: {
  projectId: string;
  appId: string;
  eventId: string;
  items: ParsedItem[];
  receivedAt: string;
}): MetricSample[] {
  const { projectId, appId, eventId, items, receivedAt } = input;
  const samples: MetricSample[] = [];
  const add = (
    metric: string,
    value: number,
    dimension: string,
    tags: Record<string, string>,
  ) => {
    if (!Number.isFinite(value)) return;
    samples.push({
      projectId,
      appId,
      eventId,
      metric,
      value,
      dimension,
      tags,
      receivedAt,
    });
  };

  for (const item of items) {
    if (item.header.type !== "event" && item.header.type !== "transaction") {
      continue;
    }
    const record = toRecord(normalizeTransactionPayload(item.payload));
    const dimension = dimensionOf(record);
    const tags = tagsOf(record);

    add("event_count", 1, dimension, tags);
    let hasDurationSentinel = false;
    if (item.header.type === "event") {
      const level = normalizeLevel(record);
      if (level === "error") add("error_count", 1, dimension, tags);
      if (level === "fatal") add("fatal_count", 1, dimension, tags);
    } else {
      const start = toSeconds(record.start_timestamp);
      const end = toSeconds(record.timestamp);
      if (start !== null && end !== null && end >= start) {
        add("duration", (end - start) * 1000, dimension, tags);
        hasDurationSentinel = true;
      }
    }

    const measurements = record.measurements;
    if (!measurements || typeof measurements !== "object") continue;
    for (const [name, entry] of Object.entries(measurements as Record<string, unknown>)) {
      if (name === "duration" && hasDurationSentinel) continue;
      const value =
        entry && typeof entry === "object"
          ? (entry as { value?: unknown }).value
          : entry;
      const numeric = toNumber(value);
      if (numeric !== null) add(name, numeric, dimension, tags);
    }
  }

  return samples;
}
