/**
 * Hop 5 — live feed (browser -> NATS WebSocket).
 *
 * The browser subscribes to the app's shard itself: the backend does not
 * fan events out anymore. This test drives the same client module the UI
 * uses (`frontend/src/lib/live-events.ts`) over the WebSocket listener,
 * authenticates through the auth callout (the test runs the callout
 * service on its own connection) and asserts that a published envelope
 * arrives in the events-API item shape. Nothing downstream is asserted.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import {
  parseLiveMessages,
  subscribeLiveFeed,
  type LiveEventItem,
} from "../../frontend/src/lib/live-events";
import { startAuthCallout } from "../nats-auth-callout";
import {
  ADMIN_TOKEN,
  app,
  connectTestNats,
  startTestApp,
  waitFor,
} from "./test-helpers";

const NATS_WS_URL = process.env.NATS_WS_URL || "ws://localhost:9222";
// The dev issuer keypair is committed (docker-compose nats config); tests
// sign verdicts with the same key the broker trusts.
process.env.NATS_AUTH_KEY_SEED ||= "SAAICRLV2CKHUW4DJ4UWKWWZOXS7K4AZ7F3DWLXHXA5FUVBM2OUZ3O3ITM";

let nats: NatsConnection;

beforeAll(async () => {
  nats = await connectTestNats();
  // The browser-style connection needs a verdict: run the callout service
  // on this (config-user) connection, like the backend process does.
  startAuthCallout(nats, () => app.store.adminTokenHash as string);
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
  appNumber: number;
}): Promise<() => void> {
  return new Promise((resolve) => {
    const close = subscribeLiveFeed(
      {
        ...handlers,
        onStatus: (status) => {
          if (status === "connected") resolve(close);
        },
      },
      { url: NATS_WS_URL, appNumber: handlers.appNumber, authToken: ADMIN_TOKEN },
    );
  });
}

describe("Hop 5: live feed over the NATS WebSocket", () => {
  it("delivers a published envelope in the events-API item shape", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const items: LiveEventItem[] = [];
    const close = await startFeed({ onItem: (item) => items.push(item), appNumber: app.appNumber });
    // "connected" is the socket's open event; the SUB registers only after
    // the auth callout admits the connection, so give it a beat.
    await Bun.sleep(300);
    try {
      await publish(`sentry.events.${app.appNumber}`, {
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
    expect(parseLiveMessages("not json")).toEqual([]);
    expect(parseLiveMessages("[]")).toEqual([]);
  });

  it("parses a newline-batched payload into one item per envelope", () => {
    const envelope = (id: string) => JSON.stringify({ id, envelopeHeader: "{}", envelopeItems: "[]" });
    const parsed = parseLiveMessages(`${envelope("a")}\n${envelope("b")}\n`);
    expect(parsed.map((m) => m.id)).toEqual(["a", "b"]);
  });
});
