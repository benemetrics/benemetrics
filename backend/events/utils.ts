export interface ParsedEnvelope {
  header: Record<string, unknown>;
  items: Array<{
    header: Record<string, unknown>;
    payload: unknown;
  }>;
}

export function parseEnvelope(headerText: string, itemsText: string): ParsedEnvelope | null {
  try {
    const header = JSON.parse(headerText);
    const items = JSON.parse(itemsText);
    return { header, items };
  } catch {
    return null;
  }
}

export function extractEventId(envelope: { header: Record<string, unknown>; items: Array<{ header: Record<string, unknown>; payload: unknown }> }): string {
  // Header event_id
  if (envelope.header.event_id && typeof envelope.header.event_id === "string") {
    return envelope.header.event_id;
  }

  // First event/transaction item event_id
  for (const item of envelope.items) {
    if (item.payload && typeof item.payload === "object") {
      const payload = item.payload as Record<string, unknown>;
      if (payload.event_id && typeof payload.event_id === "string") {
        return payload.event_id;
      }
    }
  }

  // Fallback to random UUID
  return crypto.randomUUID();
}

export function convertSpanToTransaction(envelope: { header: Record<string, unknown>; items: Array<{ header: Record<string, unknown>; payload: unknown }> }): { header: Record<string, unknown>; items: Array<{ header: Record<string, unknown>; payload: unknown }> } {
  // Simplified - would convert span items to transaction format
  return envelope;
}

export function normalizeTransactionPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = payload as Record<string, unknown>;
  if (p.contexts && typeof p.contexts === "object") {
    const contexts = p.contexts as Record<string, unknown>;
    if (contexts.trace && typeof contexts.trace === "object") {
      p.contexts = { ...contexts, trace: contexts.trace };
    }
  }
  return p;
}

export function replayIdFromEnvelope(items: Array<{ header: Record<string, unknown>; payload: unknown }>): string | null {
  for (const item of items) {
    if (item.header.type === "replay_event" && item.payload && typeof item.payload === "object") {
      const replayId = (item.payload as Record<string, unknown>).replay_id;
      if (typeof replayId === "string" && replayId.length > 0) return replayId;
    }
    if (item.payload && typeof item.payload === "object") {
      const contexts = (item.payload as Record<string, unknown>).contexts;
      if (contexts && typeof contexts === "object") {
        const replay = (contexts as Record<string, unknown>).replay;
        if (replay && typeof replay === "object") {
          const replayId = (replay as Record<string, unknown>).replay_id;
          if (typeof replayId === "string" && replayId.length > 0) return replayId;
        }
      }
    }
  }
  return null;
}