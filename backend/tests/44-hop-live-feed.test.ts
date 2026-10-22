/**
 * Hop 5 — live feed (browser -> NATS WebSocket).
 *
 * The browser subscribes to `sentry.events` itself: the backend does not
 * fan events out anymore. This test drives the same client module the UI
 * uses (`frontend/src/lib/live-events.ts`) over the WebSocket listener
 * and asserts that a published envelope arrives in the events-API item
 * shape. Nothing downstream is asserted.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import {
  parseLiveMessage,
  subscribeLiveFeed,
  type LiveEventItem,
} from "../../frontend/src/lib/live-events";
import {
  connectTestNats,
  startTestApp,
  TEST_EVENTS_SUBJECT,
  waitFor,
} from "./test-helpers";

const NATS_WS_URL = process.env.NATS_WS_URL || "ws://localhost:9222";

let nats: NatsConnection;

beforeAll(async () => {
  nats = await connectTestNats();
});

afterAll(async () => {
  await nats.close();
});

function publish(subject: string, message: Record<string, unknown>) {
  return nats.publish(subject, new TextEncoder().encode(JSON.stringify(message)));
}

/** Starts the browser client and resolves once its subscription is live. */
function startFeed(handlers: {
  onItem: (item: LiveEventItem) => void;
}): Promise<() => void> {
  return new Promise((resolve) => {
    const close = subscribeLiveFeed(
      {
        ...handlers,
        onStatus: (status) => {
          if (status === "connected") resolve(close);
        },
      },
      { url: NATS_WS_URL },
    );
  });
}

describe("Hop 5: live feed over the NATS WebSocket", () => {
  it("delivers a published envelope in the events-API item shape", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const items: LiveEventItem[] = [];
    const close = await startFeed({ onItem: (item) => items.push(item) });
    try {
      await publish(TEST_EVENTS_SUBJECT, {
        id: eventId,
        projectId: app.projectId,
        appId: app.appId,
        envelopeHeader: JSON.stringify({ event_id: eventId }),
        envelopeItems: JSON.stringify([
          {
            header: { type: "event", length: 0 },
            payload: { event_id: eventId, message: "hop five", level: "error" },
          },
        ]),
        receivedAt: new Date().toISOString(),
        type: "store",
      });

      const received = await waitFor(
        async () => items.find((item) => item.id === eventId) ?? null,
        (value) => value !== null,
      );
      expect(received).not.toBeNull();
      expect(received?.projectId).toBe(app.projectId);
      expect(received?.appId).toBe(app.appId);
      expect(received?.itemTypes).toEqual(["event"]);
      expect((received?.event as { message?: string } | undefined)?.message).toBe("hop five");
    } finally {
      close();
    }
  });

  it("ignores messages that are not envelopes", () => {
    expect(parseLiveMessage("not json")).toBeNull();
    expect(parseLiveMessage("[]")).toBeNull();
  });
});
