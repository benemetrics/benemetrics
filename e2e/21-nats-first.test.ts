/**
 * E2E Test: NATS-first ingestion (optional broker)
 *
 * Runs only when NATS_TEST_URL points at a JetStream-enabled server:
 *
 *   docker run -d -p 4223:4222 nats:latest -js
 *   NATS_TEST_URL=nats://localhost:4223 bun test e2e/21-nats-first.test.ts
 *
 * Verifies the broker path end to end: the ingestion request publishes
 * the event to NATS (no synchronous Postgres write), the persistence
 * consumer stores it and the live consumer pushes it to WebSocket
 * clients. Skipped (not failed) when no broker is configured, since
 * NATS is optional.
 */

import { describe, it, expect } from "bun:test";

const natsUrl = process.env.NATS_TEST_URL;

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const hexEventId = () => crypto.randomUUID().replaceAll("-", "");

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  let last = await fn();
  while (!predicate(last) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await fn();
  }
  return last;
}

describe("NATS-first ingestion", () => {
  it.skipIf(!natsUrl)("persists through consumers and pushes to live clients", async () => {
    // NATS_SERVERS must be set before the backend modules load, so
    // everything is imported dynamically from here on.
    process.env.NATS_SERVERS = natsUrl!;
    const { initNats, closeNats, isNatsConnected } = await import("../backend/nats");
    const { startTestServer } = await import("./test-helpers");
    const { storedEventDAO } = await import("db/dao/stored-event");

    await initNats();
    expect(isNatsConnected()).toBe(true);

    const server = await startTestServer();
    let ws: WebSocket | undefined;
    try {
      // Live consumer path: connect a client before ingesting.
      const liveMessages: Array<{ type: string; id?: string }> = [];
      ws = new WebSocket(`ws://localhost:${new URL(server.baseUrl).port}/events/live/feed`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket connect timed out")), 5000);
        ws!.addEventListener("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws!.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("WebSocket connect failed"));
        });
      });
      ws.addEventListener("message", (messageEvent: MessageEvent) => {
        try {
          liveMessages.push(JSON.parse(String(messageEvent.data)));
        } catch {
          // Ignore malformed frames.
        }
      });

      const publicKey = new URL(server.dsn).username;
      const number = new URL(server.dsn).pathname;
      const eventId = hexEventId();
      const response = await fetch(
        `${server.baseUrl}/api${number}/store/?sentry_key=${encodeURIComponent(publicKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: eventId, message: `nats-first ${uniq()}` }),
        },
      );
      expect(response.status).toBe(200);

      // The request never touches Postgres in this mode — the row can
      // only appear once the persistence consumer processed the message.
      const stored = await waitFor(
        () => storedEventDAO.findById(eventId),
        (row) => Boolean(row),
      );
      expect(stored?.id).toBe(eventId);

      // And the live consumer broadcasts the same event to WS clients.
      const live = await waitFor(
        async () => liveMessages.find((message) => message.type === "event" && message.id === eventId),
        (message) => Boolean(message),
      );
      expect(live?.id).toBe(eventId);
    } finally {
      ws?.close();
      server.stop();
      await closeNats();
    }
  });
});
