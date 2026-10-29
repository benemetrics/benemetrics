import type { EnvelopeHeader } from "../protocol/envelope-header";
import type { ItemHeader } from "../protocol/item-header";

export interface ParsedEnvelope {
  header: EnvelopeHeader;
  items: Array<{ header: ItemHeader; payload: unknown }>;
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function parseEnvelope(raw: string): ParsedEnvelope | null {
  const bytes = new TextEncoder().encode(raw);
  const decoder = new TextDecoder();
  let offset = 0;

  const readLine = (): string | null => {
    if (offset >= bytes.length) return null;
    let end = bytes.indexOf(0x0a, offset);
    if (end === -1) end = bytes.length;
    const line = decoder.decode(bytes.subarray(offset, end));
    offset = end < bytes.length ? end + 1 : end;
    return line;
  };

  try {
    const headerLine = readLine();
    if (headerLine === null) return null;
    const header = JSON.parse(headerLine || "{}") as EnvelopeHeader;

    const items: ParsedEnvelope["items"] = [];
    while (offset < bytes.length) {
      const itemHeaderLine = readLine();
      if (itemHeaderLine === null) break;
      if (!itemHeaderLine.trim()) continue;

      let itemHeader: ItemHeader;
      try {
        itemHeader = JSON.parse(itemHeaderLine) as ItemHeader;
      } catch {
        break;
      }

      const length =
        typeof itemHeader.length === "number" && itemHeader.length > 0
          ? itemHeader.length
          : null;

      let payloadText: string;
      if (length !== null) {
        const end = Math.min(offset + length, bytes.length);
        let sliced = decoder.decode(bytes.subarray(offset, end));
        let consumed = end;

        if (!isJson(sliced)) {
          const lineEnd = bytes.indexOf(0x0a, offset);
          const lineStop = lineEnd === -1 ? bytes.length : lineEnd;
          const line = decoder.decode(bytes.subarray(offset, lineStop));
          if (isJson(line)) {
            sliced = line;
            consumed = lineEnd === -1 ? bytes.length : lineEnd + 1;
          }
        }

        payloadText = sliced;
        offset = consumed;
        if (bytes[offset] === 0x0a) offset += 1;
      } else {
        const payloadLine = readLine();
        if (payloadLine === null) break;
        payloadText = payloadLine;
      }

      let payload: unknown = null;
      try {
        payload = JSON.parse(payloadText);
      } catch {
        payload = payloadText;
      }
      items.push({ header: itemHeader, payload });
    }

    return { header, items };
  } catch (e) {
    console.error("Failed to parse envelope:", e);
    return null;
  }
}

export function parseStoredEnvelope(stored: {
  envelopeHeader: string;
  envelopeItems: string;
}): ParsedEnvelope | null {
  try {
    const header = JSON.parse(stored.envelopeHeader || "{}") as EnvelopeHeader;
    const items = JSON.parse(stored.envelopeItems);
    if (Array.isArray(items)) {
      return { header, items: items as ParsedEnvelope["items"] };
    }
  } catch {}
  return null;
}

export function extractEventId(parsed: {
  header: EnvelopeHeader;
  items: Array<{ header: ItemHeader; payload: unknown }>;
}): string {
  if (parsed.header.event_id) return parsed.header.event_id;

  for (const item of parsed.items) {
    if (
      item.header.type === "event" &&
      item.payload &&
      typeof item.payload === "object" &&
      "event_id" in item.payload
    ) {
      return (item.payload as { event_id: string }).event_id;
    }
  }

  for (const item of parsed.items) {
    if (
      item.header.type === "transaction" &&
      item.payload &&
      typeof item.payload === "object" &&
      "event_id" in item.payload
    ) {
      return (item.payload as { event_id: string }).event_id;
    }
  }

  for (const item of parsed.items) {
    if (
      item.header.type === "span" &&
      item.payload &&
      typeof item.payload === "object" &&
      "trace_id" in item.payload
    ) {
      const spanPayload = item.payload as any;
      if (spanPayload.trace_id) return spanPayload.trace_id;
    }
  }

  // A check-in's own id is its stable event id: retries and status updates
  // dedupe against it, and clients can fetch the check-in by the id the SDK
  // returned from captureCheckIn.
  for (const item of parsed.items) {
    if (item.header.type !== "check_in") continue;
    if (!item.payload || typeof item.payload !== "object") continue;
    const checkInId = (item.payload as { check_in_id?: unknown }).check_in_id;
    if (typeof checkInId === "string" && checkInId.length > 0) return checkInId;
  }

  return crypto.randomUUID();
}
export function extractEventItems(
  envelopeItems: string,
): Array<Record<string, unknown>> {
  try {
    const items = JSON.parse(envelopeItems);
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (item) =>
          item?.header?.type === "event" &&
          item?.payload &&
          typeof item.payload === "object",
      )
      .map((item) => item.payload as Record<string, unknown>);
  } catch {
    return [];
  }
}

export function extractRelease(parsed: {
  items: Array<{ header: ItemHeader; payload: unknown }>;
}): string | null {
  for (const item of parsed.items) {
    if (item.header.type !== "event" && item.header.type !== "transaction") {
      continue;
    }
    if (!item.payload || typeof item.payload !== "object") continue;
    const release = (item.payload as Record<string, unknown>).release;
    if (typeof release === "string" && release.length > 0) return release;
  }
  return null;
}

export function normalizeTransactionPayload(payload: unknown): unknown {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, any>;
    if ("contexts" in p && p.contexts && typeof p.contexts === "object") {
      const trace = p.contexts.trace;
      if (trace && typeof trace === "object") {
        if ("trace_id" in trace && !("trace_id" in p))
          p.trace_id = trace.trace_id;
        if ("status" in trace && !("status" in p)) p.status = trace.status;
        if (
          "measurements" in trace &&
          trace.measurements !== undefined &&
          !("measurements" in p)
        )
          p.measurements = trace.measurements;
        if ("data" in trace && trace.data && typeof trace.data === "object") {
          const measurements: Record<string, any> = {};
          for (const [key, val] of Object.entries(trace.data)) {
            if (
              key.startsWith("sentry.measurement.") &&
              typeof val === "number"
            ) {
              const measurementName = key.replace("sentry.measurement.", "");
              measurements[measurementName] = { value: val };
            }
          }
          if (Object.keys(measurements).length > 0 && !("measurements" in p))
            p.measurements = measurements;
        }
      }
    }
    if (
      "measurements" in p &&
      p.measurements !== undefined &&
      typeof p.measurements === "object"
    ) {
      const measurements: Record<string, any> = {};
      for (const [key, val] of Object.entries(p.measurements)) {
        if (typeof val === "object" && val !== null && "value" in val)
          measurements[key] = val;
        else if (typeof val === "number") measurements[key] = { value: val };
        else if (
          typeof val === "string" &&
          val.trim() !== "" &&
          Number.isFinite(Number(val))
        ) {
          measurements[key] = { value: Number(val) };
        }
      }
      if (Object.keys(measurements).length > 0) p.measurements = measurements;
    }
  }
  return payload;
}

export function convertSpanToTransaction(
  itemHeader: ItemHeader,
  payload: unknown,
): { header: ItemHeader; payload: unknown } {
  const p = payload as Record<string, any>;

  if (p.version === 2 && Array.isArray(p.items)) {
    const spans = p.items;
    const segmentSpan = spans.find((s: any) => s.is_segment) || spans[0];

    if (segmentSpan) {
      const transactionPayload: Record<string, any> = {
        transaction:
          segmentSpan.name ||
          segmentSpan.attributes?.["sentry.segment.name"]?.value ||
          "unknown",
        event_id: segmentSpan.span_id || crypto.randomUUID(),
        trace_id: segmentSpan.trace_id,
        span_id: segmentSpan.span_id,
        start_timestamp: segmentSpan.start_timestamp,
        timestamp: segmentSpan.end_timestamp,
      };

      if (segmentSpan.attributes?.sentry.op)
        transactionPayload.op = segmentSpan.attributes["sentry.op"].value;
      if (segmentSpan.status) transactionPayload.status = segmentSpan.status;

      const measurements: Record<string, any> = {};

      if (segmentSpan.attributes) {
        for (const [key, attr] of Object.entries(segmentSpan.attributes)) {
          if (key.startsWith("sentry.measurement.")) {
            const measurementName = key.replace("sentry.measurement.", "");
            if (typeof attr === "object" && attr !== null) {
              if ("value" in attr && typeof attr.value === "number")
                measurements[measurementName] = { value: attr.value };
              else if (typeof attr === "number")
                measurements[measurementName] = { value: attr };
              else if ("value" in attr)
                measurements[measurementName] = { value: attr.value };
            }
          }
        }
      }

      if (
        segmentSpan.measurements &&
        typeof segmentSpan.measurements === "object"
      ) {
        for (const [key, val] of Object.entries(segmentSpan.measurements)) {
          if (typeof val === "number") measurements[key] = { value: val };
        }
      }

      if (Object.keys(measurements).length > 0)
        transactionPayload.measurements = measurements;

      const childSpans = spans.filter((s: any) => !s.is_segment);
      if (childSpans.length > 0) {
        transactionPayload.spans = childSpans.map((s: any) => ({
          span_id: s.span_id,
          parent_span_id: s.parent_span_id,
          name: s.name,
          op: s.attributes?.sentry.op?.value || s.op,
          start_timestamp: s.start_timestamp,
          timestamp: s.end_timestamp,
          status: s.status,
        }));
      }

      transactionPayload.contexts = {
        trace: {
          trace_id: segmentSpan.trace_id,
          span_id: segmentSpan.span_id,
          op: segmentSpan.attributes?.sentry.op?.value || transactionPayload.op,
          status: segmentSpan.status,
          ...(segmentSpan.parent_span_id
            ? { parent_span_id: segmentSpan.parent_span_id }
            : {}),
        },
      };

      if (segmentSpan.start_timestamp && segmentSpan.end_timestamp) {
        transactionPayload.duration =
          segmentSpan.end_timestamp - segmentSpan.start_timestamp;
      }

      return {
        header: { ...itemHeader, type: "transaction" as const },
        payload: transactionPayload,
      };
    }
  }
  return { header: itemHeader, payload };
}
