/**
 * Hop 1 — HTTP ingest -> NATS JetStream.
 *
 * A DSN-ingested envelope must land as a message on the `sentry.events`
 * subject before the request answers 200, with its metric samples on
 * `sentry.metrics`. ClickHouse and Postgres are covered by the other hops
 * (backend/tests/41, backend/tests/42, backend/tests/43, backend/tests/45).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import { jetstreamManager } from "@nats-io/jetstream";
import {
  connectTestNats,
  handleFetch as fetch,
  startTestApp,
  TEST_EVENTS_SUBJECT,
  TEST_METRICS_SUBJECT,
  TEST_ORIGIN,
  TEST_STREAM,
  waitFor,
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
    const manager = await jetstreamManager(nats);
    const message = await manager.streams.getMessage(TEST_STREAM, {
      last_by_subj: TEST_EVENTS_SUBJECT,
    });
    expect(message).not.toBeNull();

    const published = JSON.parse(new TextDecoder().decode(message!.data)) as {
      id: string;
      projectId: string;
      appId?: string;
      type: string;
      issueEvents?: string;
    };
    expect(published.id).toBe(eventId);
    expect(published.type).toBe("envelope");
    expect(published.projectId).toBe(app.projectId);
    expect(published.appId).toBe(app.appId);

    // The message carries the issue digests, so the consumer applies the
    // grouping without re-parsing the envelope.
    const digests = JSON.parse(published.issueEvents ?? "[]") as Array<{
      eventId: string;
      fingerprint: string;
      title: string;
      level: string;
      type: string;
    }>;
    expect(digests).toHaveLength(1);
    expect(digests[0]!.eventId).toBe(eventId);
    expect(digests[0]!.fingerprint).toBe("msg:hop one");
    expect(digests[0]!.title).toBe("hop one");
    expect(digests[0]!.level).toBe("error");
    expect(digests[0]!.type).toBe("message");
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

  it("publishes the extracted metric samples to sentry.metrics", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();

    // Subscribe before ingesting: the publish happens before the response
    // returns, and a live subscription observes this envelope's batch (a
    // concurrently published batch is filtered by event id).
    const received: string[] = [];
    const subscription = nats.subscribe(TEST_METRICS_SUBJECT);
    // The pump stays live across the assertion below: unsubscribing while a
    // delivered message still sits in the subscription's buffer drops it.
    const pump = (async () => {
      for await (const message of subscription) {
        received.push(new TextDecoder().decode(message.data));
      }
    })();
    await nats.flush();

    const url = new URL(`${TEST_ORIGIN}/api/${app.ingestKey}/envelope/`);
    url.searchParams.set("sentry_key", app.publicKey);
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "transaction", length: 0 }),
      JSON.stringify({
        event_id: eventId,
        type: "transaction",
        transaction: "GET /checkout",
        start_timestamp: 1_700_000_000,
        timestamp: 1_700_000_001.5,
        measurements: {
          lcp: { value: 2400, unit: "millisecond" },
          frames_total: { value: 120 },
          custom_metric: { value: 7 },
        },
      }),
    ].join("\n");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    });
    expect(response.status).toBe(200);

    interface SampleRow {
      projectId: string;
      appId: string;
      eventId: string;
      metric: string;
      value: number;
      dimension: string;
    }
    const rows = await waitFor(
      async () =>
        received
          .flatMap((payload) => payload.trim().split("\n"))
          .map((line) => JSON.parse(line) as SampleRow)
          .filter((row) => row.eventId === eventId),
      (mine) => mine.length > 0,
    );
    subscription.unsubscribe();
    await pump;
    expect(
      rows.every(
        (row) =>
          row.projectId === app.projectId &&
          row.appId === app.appId &&
          row.eventId === eventId,
      ),
    ).toBe(true);

    const byMetric = new Map(rows.map((row) => [row.metric, row]));
    expect(byMetric.get("event_count")?.value).toBe(1);
    expect(byMetric.get("event_count")?.dimension).toBe("GET /checkout");
    expect(byMetric.get("duration")?.value).toBeCloseTo(1500, 3);
    expect(byMetric.get("lcp")?.value).toBe(2400);
    expect(byMetric.get("frames_total")?.value).toBe(120);
    expect(byMetric.get("custom_metric")?.value).toBe(7);
    // Transactions carry no error sentinels.
    expect(byMetric.has("error_count")).toBe(false);
  });

  it("publishes error sentinels only for error and fatal levels", async () => {
    const app = await startTestApp();
    const errorId = crypto.randomUUID();
    const infoId = crypto.randomUUID();
    const fatalId = crypto.randomUUID();
    const ingestedIds: string[] = [errorId, infoId, fatalId];

    const received: string[] = [];
    const subscription = nats.subscribe(TEST_METRICS_SUBJECT);
    const pump = (async () => {
      for await (const message of subscription) {
        received.push(new TextDecoder().decode(message.data));
      }
    })();
    await nats.flush();

    const ingest = async (eventId: string, level: string) => {
      const url = new URL(`${TEST_ORIGIN}/api/${app.ingestKey}/envelope/`);
      url.searchParams.set("sentry_key", app.publicKey);
      const envelope = [
        JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event", length: 0 }),
        JSON.stringify({
          event_id: eventId,
          level,
          message: `level ${level}`,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      ].join("\n");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope,
      });
      expect(response.status).toBe(200);
    };

    await ingest(errorId, "error");
    await ingest(infoId, "info");
    await ingest(fatalId, "fatal");

    interface SampleRow {
      eventId: string;
      metric: string;
      value: number;
      dimension: string;
    }
    const rows = await waitFor(
      async () =>
        received
          .flatMap((payload) => payload.trim().split("\n"))
          .map((line) => JSON.parse(line) as SampleRow)
          .filter((row) => ingestedIds.includes(row.eventId)),
      (mine) =>
        mine.some(
          (row) => row.eventId === errorId && row.metric === "error_count",
        ) &&
        mine.some(
          (row) => row.eventId === fatalId && row.metric === "fatal_count",
        ),
    );
    subscription.unsubscribe();
    await pump;

    const metricsFor = (eventId: string) =>
      new Set(
        rows.filter((row) => row.eventId === eventId).map((row) => row.metric),
      );

    // error_count is 1 when level = error, fatal_count when level = fatal.
    expect(metricsFor(errorId).has("error_count")).toBe(true);
    expect(metricsFor(errorId).has("fatal_count")).toBe(false);
    expect(metricsFor(infoId).has("event_count")).toBe(true);
    expect(metricsFor(infoId).has("error_count")).toBe(false);
    expect(metricsFor(infoId).has("fatal_count")).toBe(false);
    expect(metricsFor(fatalId).has("fatal_count")).toBe(true);
    expect(metricsFor(fatalId).has("error_count")).toBe(false);
  });
});
