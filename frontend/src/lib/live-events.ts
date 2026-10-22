/**
 * Live feed: the browser subscribes to NATS directly.
 *
 * There is no backend fan-out: the UI opens its own WebSocket connection
 * to NATS (`nats.ws`) and subscribes to the `sentry.events` subject, where
 * every ingested envelope arrives as one JSON message (`id, projectId,
 * appId, envelopeHeader, envelopeItems, receivedAt, type`). Envelopes are
 * parsed with the same parser the events API uses
 * (`backend/events/utils.ts`), so a live item has exactly the shape the
 * list endpoint returns.
 *
 * One connection serves the whole UI: the pages subscribe to the feed, the
 * sidebar watches the connection state — that state is the health signal,
 * there is no health endpoint to poll.
 *
 * URL: `globalThis.__NATS_WS_URL__` when the deployment injects one
 * (production keeps NATS behind TLS, optionally with a token), otherwise
 * the local dev listener on the UI host (`ws://<hostname>:9222`), which
 * mirrors the NATS service of the compose file. The client reconnects on
 * its own; while it is down the pages keep polling.
 */

import { connect, type NatsConnection, type Subscription } from "nats.ws";
import {
  convertSpanToTransaction,
  normalizeTransactionPayload,
  parseStoredEnvelope,
} from "../../../backend/events/utils";

export interface LiveEventItem {
  /** Event id, as stored (duplicate retries collapse by this id). */
  id: string;
  projectId: string;
  appId: string | null;
  receivedAt: string;
  itemTypes: string[];
  event: unknown;
  transaction: unknown;
  feedback: unknown;
}

export type LiveFeedStatus = "connected" | "disconnected";

export interface LiveFeedHandlers {
  onItem?: (item: LiveEventItem) => void;
  onStatus?: (status: LiveFeedStatus) => void;
}

/** The subject the API publishes ingested envelopes to. */
export const LIVE_SUBJECT = "sentry.events";

/** One feed message → an events-API item, or null when unknown. */
export function parseLiveMessage(raw: string): LiveEventItem | null {
  let message: {
    id?: string;
    projectId?: string;
    appId?: string | null;
    envelopeHeader?: string;
    envelopeItems?: string;
    receivedAt?: string;
  };
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;

  const parsed = parseStoredEnvelope({
    envelopeHeader: message.envelopeHeader ?? "{}",
    envelopeItems: message.envelopeItems ?? "[]",
  });
  if (!parsed) return null;

  const items = parsed.items.map((item) =>
    item.header.type === "span"
      ? convertSpanToTransaction(item.header, item.payload)
      : item,
  );
  const eventItem = items.find((item) => item.header.type === "event");
  const transactionItem = items.find((item) => item.header.type === "transaction");
  const feedbackItem = items.find(
    (item) => item.header.type === "feedback" || item.header.type === "user_feedback",
  );

  return {
    id: message.id ?? parsed.header.event_id ?? `${Date.now()}`,
    projectId: message.projectId ?? "",
    appId: message.appId ?? null,
    receivedAt: message.receivedAt ?? new Date().toISOString(),
    itemTypes: items.map((item) => item.header.type),
    event: eventItem ? normalizeTransactionPayload(eventItem.payload) : null,
    transaction: transactionItem ? normalizeTransactionPayload(transactionItem.payload) : null,
    feedback: feedbackItem ? normalizeTransactionPayload(feedbackItem.payload) : null,
  };
}

function defaultNatsWsUrl(): string {
  const injected = (globalThis as { __NATS_WS_URL__?: string }).__NATS_WS_URL__;
  if (injected) return injected;
  if (typeof window === "undefined") return "ws://localhost:9222";
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.hostname}:9222`;
}

type ItemHandler = (item: LiveEventItem) => void;
type StatusHandler = (status: LiveFeedStatus) => void;

const itemHandlers = new Set<ItemHandler>();
const statusHandlers = new Set<StatusHandler>();
let connection: NatsConnection | null = null;
let subscription: Subscription | null = null;
let connecting = false;
let url: string | undefined;
let currentStatus: LiveFeedStatus = "disconnected";

function announce(status: LiveFeedStatus): void {
  currentStatus = status;
  for (const handler of statusHandlers) handler(status);
}

async function open(): Promise<void> {
  if (connection || connecting) return;
  connecting = true;
  try {
    const nc = await connect({ servers: url ?? defaultNatsWsUrl() });
    connection = nc;
    subscription = nc.subscribe(LIVE_SUBJECT);
    // Registration is only complete once the server has the SUB —
    // otherwise a message published right after "connected" is lost.
    await nc.flush();
    announce("connected");
    void (async () => {
      if (!subscription) return;
      for await (const message of subscription) {
        const parsed = parseLiveMessage(new TextDecoder().decode(message.data));
        if (!parsed) continue;
        for (const handler of itemHandlers) handler(parsed);
      }
      announce("disconnected");
    })();
  } catch {
    announce("disconnected");
  } finally {
    connecting = false;
  }
}

/**
 * Subscribes to the live feed; returns the unsubscribe function. The
 * connection is shared: it opens with the first subscriber and closes with
 * the last one. The feed is best-effort — a failed connect only means no
 * live items.
 */
export function subscribeLiveFeed(
  handlers: LiveFeedHandlers,
  options: { url?: string } = {},
): () => void {
  if (options.url) url = options.url;
  if (handlers.onItem) itemHandlers.add(handlers.onItem);
  if (handlers.onStatus) {
    statusHandlers.add(handlers.onStatus);
    // A late subscriber learns the state of the shared connection at once.
    handlers.onStatus(currentStatus);
  }
  void open();

  return () => {
    if (handlers.onItem) itemHandlers.delete(handlers.onItem);
    if (handlers.onStatus) statusHandlers.delete(handlers.onStatus);
    if (itemHandlers.size > 0 || statusHandlers.size > 0) return;
    try {
      subscription?.unsubscribe();
    } catch {
      // the connection is already gone
    }
    subscription = null;
    const open_connection = connection;
    connection = null;
    void open_connection?.close().catch(() => {});
  };
}
