import type { SentryEventMessage } from "./nats";

// Live event fan-out for WebSocket clients: the NATS live consumer (or,
// when the broker is unavailable, the in-process ingestion fallback)
// pushes every freshly stored event here.
export interface LiveEventClient {
  send(data: string): unknown;
}

export interface LiveEventMessage {
  type: "event";
  id: string;
  projectId: string;
  appId?: string;
  receivedAt: string;
  itemTypes: string[];
  /** Ingest flavor that produced the event: envelope, store or OTLP. */
  kind: string;
}

export interface LiveClearMessage {
  type: "clear";
}

export type LiveMessage = LiveEventMessage | LiveClearMessage;

const clients = new Set<LiveEventClient>();

export function addLiveClient(client: LiveEventClient): void {
  clients.add(client);
}

export function removeLiveClient(client: LiveEventClient): void {
  clients.delete(client);
}

export function buildLiveEvent(event: SentryEventMessage): LiveEventMessage {
  let itemTypes: string[] = [];
  try {
    const items = JSON.parse(event.envelopeItems) as Array<{
      header?: { type?: unknown };
    }>;
    itemTypes = items
      .map((item) => item.header?.type)
      .filter((type): type is string => typeof type === "string");
  } catch {
    itemTypes = [];
  }

  return {
    type: "event",
    id: event.id,
    projectId: event.projectId,
    appId: event.appId,
    receivedAt: event.receivedAt,
    itemTypes,
    kind: event.type,
  };
}

export function broadcastLive(message: LiveMessage): void {
  if (clients.size === 0) return;

  const data = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {
      clients.delete(client);
    }
  }
}
