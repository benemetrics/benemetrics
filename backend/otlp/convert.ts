import type {
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpSpan,
  OtlpExportTraceServiceRequest,
} from "../protocol/otlp";
import type { EnvelopeHeader } from "../protocol/envelope-header";
import type { ItemHeader } from "../protocol/item-header";

const STATUS_OK = 1;
const STATUS_ERROR = 2;

const KIND_SERVER = 2;
const KIND_CLIENT = 3;
const KIND_PRODUCER = 4;
const KIND_CONSUMER = 5;

interface FlattenedSpan {
  span: OtlpSpan;
  tags: Record<string, string>;
}

export interface OtlpEnvelope {
  id: string;
  envelopeHeader: string;
  envelopeItems: string;
  // Kept beside the serialized envelope so the caller need not re-parse.
  items: Array<{ header: ItemHeader; payload: unknown }>;
}

function randomHex(length: number): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

function nanoToSeconds(nano: string | number | undefined): number | undefined {
  if (nano === undefined || nano === null) return undefined;
  const str = String(nano);
  if (!/^\d+$/.test(str)) {
    const parsed = Number(nano);
    return Number.isFinite(parsed) ? parsed / 1e9 : undefined;
  }
  if (str.length <= 9) return Number(str) / 1e9;
  return Number(`${str.slice(0, str.length - 9)}.${str.slice(str.length - 9)}`);
}

function unwrapValue(value: OtlpAnyValue | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return Number(value.intValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("boolValue" in value) return value.boolValue;
  if ("arrayValue" in value)
    return (value.arrayValue?.values ?? []).map(unwrapValue);
  if ("kvlistValue" in value) {
    const out: Record<string, unknown> = {};
    for (const entry of value.kvlistValue?.values ?? []) {
      if (entry.key) out[entry.key] = unwrapValue(entry.value);
    }
    return out;
  }
  return undefined;
}

function toTags(
  attributes: OtlpKeyValue[] | undefined,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const attribute of attributes ?? []) {
    if (!attribute.key || attribute.key.startsWith("sentry.measurement."))
      continue;
    const value = unwrapValue(attribute.value);
    if (value === undefined || value === null) continue;
    out[attribute.key] =
      typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function toMeasurements(
  attributes: OtlpKeyValue[] | undefined,
): Record<string, { value: number }> {
  const measurements: Record<string, { value: number }> = {};
  for (const attribute of attributes ?? []) {
    if (!attribute.key?.startsWith("sentry.measurement.")) continue;
    const value = unwrapValue(attribute.value);
    if (typeof value === "number" && Number.isFinite(value)) {
      measurements[attribute.key.replace("sentry.measurement.", "")] = {
        value,
      };
    }
  }
  return measurements;
}

function spanKindToOp(kind: number | undefined): string {
  switch (kind) {
    case KIND_SERVER:
      return "server";
    case KIND_CLIENT:
      return "client";
    case KIND_PRODUCER:
      return "producer";
    case KIND_CONSUMER:
      return "consumer";
    default:
      return "internal";
  }
}

function spanStatus(status: OtlpSpan["status"]): string {
  switch (status?.code) {
    case STATUS_OK:
      return "ok";
    case STATUS_ERROR:
      return "error";
    default:
      return "unknown";
  }
}

function buildTransaction(
  span: OtlpSpan,
  tags: Record<string, string>,
): Record<string, unknown> {
  const traceId = span.traceId || randomHex(32);
  const spanId = span.spanId || randomHex(16);
  const startTimestamp =
    nanoToSeconds(span.startTimeUnixNano) ?? Date.now() / 1000;
  const endTimestamp = nanoToSeconds(span.endTimeUnixNano) ?? startTimestamp;
  const status = spanStatus(span.status);
  const op = spanKindToOp(span.kind);

  return {
    transaction: span.name || "unknown",
    event_id: spanId,
    trace_id: traceId,
    span_id: spanId,
    start_timestamp: startTimestamp,
    timestamp: endTimestamp,
    duration: endTimestamp - startTimestamp,
    op,
    status,
    contexts: {
      trace: {
        trace_id: traceId,
        span_id: spanId,
        op,
        status,
        ...(span.parentSpanId ? { parent_span_id: span.parentSpanId } : {}),
      },
    },
    measurements: toMeasurements(span.attributes),
    tags: { ...tags, ...toTags(span.attributes) },
  };
}

function buildChildSpan(span: OtlpSpan): Record<string, unknown> {
  const startTimestamp =
    nanoToSeconds(span.startTimeUnixNano) ?? Date.now() / 1000;
  const endTimestamp = nanoToSeconds(span.endTimeUnixNano) ?? startTimestamp;
  return {
    span_id: span.spanId || randomHex(16),
    ...(span.parentSpanId ? { parent_span_id: span.parentSpanId } : {}),
    name: span.name || "unknown",
    op: spanKindToOp(span.kind),
    start_timestamp: startTimestamp,
    timestamp: endTimestamp,
    status: spanStatus(span.status),
  };
}

export function convertOtlpToEnvelopes(raw: string): OtlpEnvelope[] | null {
  let parsed: OtlpExportTraceServiceRequest;
  try {
    parsed = JSON.parse(raw) as OtlpExportTraceServiceRequest;
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.resourceSpans)
  ) {
    return null;
  }

  const flattened: FlattenedSpan[] = [];
  for (const resourceSpans of parsed.resourceSpans) {
    const tags = toTags(resourceSpans?.resource?.attributes);
    for (const scopeSpans of resourceSpans?.scopeSpans ?? []) {
      for (const span of scopeSpans?.spans ?? []) {
        flattened.push({ span, tags });
      }
    }
  }
  if (flattened.length === 0) return [];

  const byTrace = new Map<string, FlattenedSpan[]>();
  for (const item of flattened) {
    const traceId = item.span.traceId || randomHex(32);
    const group = byTrace.get(traceId);
    if (group) group.push(item);
    else byTrace.set(traceId, [item]);
  }

  const envelopes: OtlpEnvelope[] = [];
  for (const items of byTrace.values()) {
    const first = items[0];
    if (!first) continue;
    const spanIds = new Set(
      items
        .map((item) => item.span.spanId)
        .filter((id): id is string => Boolean(id)),
    );
    const segmentIndex = items.findIndex(
      (item) => !item.span.parentSpanId || !spanIds.has(item.span.parentSpanId),
    );
    const segment = segmentIndex >= 0 ? (items[segmentIndex] ?? first) : first;

    const transaction = buildTransaction(segment.span, segment.tags);
    transaction.spans = items
      .filter((item) => item !== segment)
      .map((item) => buildChildSpan(item.span));

    const eventId = transaction.event_id as string;
    const itemHeader: ItemHeader = {
      type: "transaction",
      content_type: "application/json",
      length: JSON.stringify(transaction).length,
    };
    const header: EnvelopeHeader = {
      event_id: eventId,
      sent_at: new Date().toISOString(),
      sdk: { name: "otlp-json", version: "1.0" },
    };

    envelopes.push({
      id: eventId,
      envelopeHeader: JSON.stringify(header),
      envelopeItems: JSON.stringify([
        { header: itemHeader, payload: transaction },
      ]),
      items: [{ header: itemHeader, payload: transaction }],
    });
  }
  return envelopes;
}
