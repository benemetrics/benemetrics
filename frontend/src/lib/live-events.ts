// Browser → NATS WebSocket live feed (hop 5). The backend does not fan
// events out: the browser subscribes to `sentry.events` itself over the
// NATS WebSocket listener and parses the same envelope shape the events
// API returns.

export interface LiveEventItem {
  id: string;
  projectId: string;
  appId?: string;
  itemTypes: string[];
  event: Record<string, unknown> | null;
  transaction: Record<string, unknown> | null;
  feedback: Record<string, unknown> | null;
  receivedAt: string;
}

export type LiveFeedStatus = "connecting" | "connected" | "closed" | "error";

/**
 * Parses a `sentry.events` payload. The backend batches the events of a
 * 100 ms flush window into one message, newline-separated, so a payload
 * may hold more than one envelope. Returns the envelopes it could parse.
 */
export function parseLiveMessages(payload: string): LiveMessage[] {
  const parsed: Array<Record<string, unknown> & { envelopeHeader: string; envelopeItems: string }> = [];
  for (const line of payload.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (typeof record["envelopeHeader"] !== "string" || typeof record["envelopeItems"] !== "string") continue;
      parsed.push(record as never);
    } catch {
      // Not JSON (or a torn frame) — skip the line, keep the rest.
    }
  }
  return parsed;
}

type LiveMessage = Record<string, unknown> & { envelopeHeader: string; envelopeItems: string };

/** Converts one wire message into the events-API item shape. */
function toItem(message: LiveMessage): LiveEventItem | null {
  if (!message) return null;
  let items: Array<{ header?: { type?: string }; payload?: unknown }> = [];
  try {
    const parsed: unknown = JSON.parse(message.envelopeItems);
    if (!Array.isArray(parsed)) return null;
    items = parsed as never;
  } catch {
    return null;
  }
  const type = (item: { header?: { type?: string } }) => item.header?.type ?? "";
  const pick = (name: string) => items.find((item) => type(item) === name)?.payload;
  const event = pick("event");
  const transaction = pick("transaction") ?? pick("span");
  const feedback = pick("feedback") ?? pick("user_feedback");
  return {
    id: typeof message["id"] === "string" ? message["id"] : "",
    projectId: typeof message["projectId"] === "string" ? message["projectId"] : "",
    ...(typeof message["appId"] === "string" ? { appId: message["appId"] } : {}),
    itemTypes: items.map(type),
    event: event && typeof event === "object" ? (event as Record<string, unknown>) : null,
    transaction: transaction && typeof transaction === "object" ? (transaction as Record<string, unknown>) : null,
    feedback: feedback && typeof feedback === "object" ? (feedback as Record<string, unknown>) : null,
    receivedAt: typeof message["receivedAt"] === "string" ? message["receivedAt"] : new Date().toISOString(),
  };
}

// The browser derives the listener from the origin host; the port follows
// the docker-compose NATS_WEBSOCKET_PORT unless overridden at build time.
const DEFAULT_WS_PORT = 9222;

function defaultUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:${DEFAULT_WS_PORT}`;
}

// The credential rides the CONNECT options as `auth_token`: the NATS auth
// callout forwards it to the backend, which verifies it like an HTTP request.
function connectOptions(authToken?: string): string {
  return JSON.stringify({
    verbose: false,
    pedantic: false,
    tls_required: false,
    name: "glitchlog-ui",
    lang: "js",
    version: "1.0.0",
    protocol: 1,
    ...(authToken ? { auth_token: authToken } : {}),
  });
}

let nextSubscriptionId = 1;

/**
 * Low-level subscription: speaks the NATS text protocol over the WebSocket
 * listener and delivers raw message payloads to `onMessage`. Any subject
 * exposed by the listener can be subscribed this way.
 */
export function subscribeSubject(
  subject: string,
  handlers: { onMessage: (payload: string) => void; onStatus?: (status: LiveFeedStatus) => void },
  options: { url?: string; authToken?: string } = {},
): () => void {
  const url = options.url ?? defaultUrl();
  const sid = String(nextSubscriptionId++);
  let ws: WebSocket | null = null;
  let buffer = "";
  let closed = false;

  const onFrame = (data: string) => {
    buffer += data;
    for (;;) {
      const lineEnd = buffer.indexOf("\r\n");
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      const op = line.split(" ")[0];
      if (op === "MSG") {
        const count = Number(line.split(" ").at(-1));
        const payloadStart = lineEnd + 2;
        if (!Number.isFinite(count) || buffer.length < payloadStart + count) return;
        handlers.onMessage(buffer.slice(payloadStart, payloadStart + count));
        buffer = buffer.slice(payloadStart + count + 2);
      } else if (op === "PING") {
        ws?.send("PONG\r\n");
        buffer = buffer.slice(lineEnd + 2);
      } else {
        buffer = buffer.slice(lineEnd + 2);
      }
    }
  };

  try {
    ws = new WebSocket(url);
  } catch {
    handlers.onStatus?.("error");
    return () => {};
  }

  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    ws?.send(`CONNECT ${connectOptions(options.authToken)}\r\n`);
    ws?.send(`SUB ${subject} ${sid}\r\n`);
    handlers.onStatus?.("connected");
  };
  ws.onmessage = (event) => {
    // NATS sends protocol frames as binary; text only ever arrives from
    // proxies that re-frame.
    const data: unknown = event.data;
    if (typeof data === "string") onFrame(data);
    else if (data instanceof ArrayBuffer) onFrame(new TextDecoder().decode(data));
    else if (typeof Blob !== "undefined" && data instanceof Blob) void data.text().then(onFrame);
  };
  ws.onerror = () => {
    if (!closed) handlers.onStatus?.("error");
  };
  ws.onclose = () => {
    if (!closed) handlers.onStatus?.("closed");
  };

  return () => {
    closed = true;
    handlers.onStatus?.("closed");
    try {
      ws?.close();
    } catch {
      // already closed
    }
  };
}

/** Subscribes to one app's events shard over the NATS WebSocket listener. */
export function subscribeLiveFeed(
  handlers: { onItem?: (item: LiveEventItem) => void; onStatus?: (status: LiveFeedStatus) => void },
  options: { url?: string; appNumber?: number; authToken?: string } = {},
): () => void {
  return subscribeSubject(
    options.appNumber !== undefined ? `sentry.events.${options.appNumber}` : "sentry.events.*",
    {
      onMessage: (payload) => {
        for (const message of parseLiveMessages(payload)) {
          const item = toItem(message);
          if (item) handlers.onItem?.(item);
        }
      },
      ...(handlers.onStatus ? { onStatus: handlers.onStatus } : {}),
    },
    {
      ...(options.url !== undefined ? { url: options.url } : {}),
      ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
    },
  );
}
