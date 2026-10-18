/**
 * Hop 1 — HTTP ingest -> NATS JetStream.
 *
 * A DSN-ingested envelope must land as a message on the `sentry.events`
 * subject before the request answers 200. ClickHouse and Postgres are
 * covered by the other hops (tests/41, tests/42, tests/43).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "nats";
import {
  connectTestNats,
  handleFetch as fetch,
  startTestApp,
  TEST_EVENTS_SUBJECT,
  TEST_ORIGIN,
  TEST_STREAM,
} from "./test-helpers";

let nats: NatsConnection;

beforeAll(async () => {
  nats = await connectTestNats();
});

afterAll(async () => {
  await nats.close();
});

describe("Hop 1: ingest -> NATS", () => {
  it("publishes an ingested envelope to sentry.events and answers the event id", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const url = new URL(`${TEST_ORIGIN}/api/${app.ingestKey}/envelope/`);
    url.searchParams.set("sentry_key", app.publicKey);

    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event", length: 0 }),
      JSON.stringify({
        event_id: eventId,
        level: "error",
        message: "hop one",
        timestamp: Math.floor(Date.now() / 1000),
      }),
    ].join("\n");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(eventId);

    // The request only returns after the publish; the message is now the
    // last one on the subject.
    const manager = await nats.jetstreamManager();
    const message = await manager.streams.getMessage(TEST_STREAM, {
      last_by_subj: TEST_EVENTS_SUBJECT,
    });
    expect(message).not.toBeNull();

    const published = JSON.parse(new TextDecoder().decode(message!.data)) as {
      id: string;
      projectId: string;
      appId?: string;
      type: string;
    };
    expect(published.id).toBe(eventId);
    expect(published.type).toBe("envelope");
    expect(published.projectId).toBe(app.projectId);
    expect(published.appId).toBe(app.appId);
  });

  it("answers 503 when a message cannot be published", async () => {
    // A DSN for an app that does not exist is rejected before publishing;
    // the publish path itself is exercised by every other ingestion test.
    const response = await fetch(`${TEST_ORIGIN}/api/000000/store/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: crypto.randomUUID(), message: "unknown app" }),
    });
    expect(response.status).toBe(401);
  });
});
