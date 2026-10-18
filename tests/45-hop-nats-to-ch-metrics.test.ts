/**
 * Hop 2 (metrics) — `sentry.metrics` -> ClickHouse.
 *
 * Samples are published as JSONEachRow (one sample per line): the NATS
 * engine table + materialized view insert them, the durable consumer
 * acknowledges only after the insert, and a redelivered batch collapses
 * in ReplacingMergeTree under FINAL reads. A `clear` truncates the
 * metrics store together with the events store.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { JetStreamClient, NatsConnection } from "nats";
import { listClickHouseMetricSamplesForEvent } from "../backend/clickhouse";
import type { MetricSample } from "../backend/protocol/metrics";
import {
  ADMIN_HEADERS,
  connectTestNats,
  handleFetch,
  startTestApp,
  TEST_METRICS_SUBJECT,
  TEST_ORIGIN,
  waitFor,
  waitForConsumerAck,
} from "./test-helpers";

let nats: NatsConnection;
let jetstream: JetStreamClient;

beforeAll(async () => {
  nats = await connectTestNats();
  jetstream = nats.jetstream();
});

afterAll(async () => {
  await nats.close();
});

const receivedAt = new Date().toISOString();

function samplesFor(
  app: { projectId: string; appId: string },
  eventId: string,
): MetricSample[] {
  return [
    { projectId: app.projectId, appId: app.appId, eventId, metric: "event_count", value: 1, dimension: "GET /metrics", receivedAt },
    { projectId: app.projectId, appId: app.appId, eventId, metric: "lcp", value: 2400, dimension: "GET /metrics", receivedAt },
    { projectId: app.projectId, appId: app.appId, eventId, metric: "frames_total", value: 120, dimension: "HomeScreen", receivedAt },
  ];
}

function publishSamples(samples: MetricSample[]) {
  const payload = samples.map((sample) => JSON.stringify(sample)).join("\n");
  return jetstream.publish(TEST_METRICS_SUBJECT, new TextEncoder().encode(payload));
}

describe("Hop 2 (metrics): sentry.metrics -> ClickHouse", () => {
  it("inserts published JSONEachRow samples and acknowledges after the insert", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const samples = samplesFor(app, eventId);

    const first = await publishSamples(samples);
    const stored = await waitFor(
      () => listClickHouseMetricSamplesForEvent(eventId),
      (rows) => rows.length === samples.length,
    );
    expect(stored.map((sample) => sample.metric)).toEqual([
      "event_count",
      "frames_total",
      "lcp",
    ]);
    expect(stored.find((sample) => sample.metric === "lcp")?.value).toBe(2400);
    expect(stored.find((sample) => sample.metric === "frames_total")?.dimension).toBe("HomeScreen");
    expect(
      stored.every(
        (sample) => sample.projectId === app.projectId && sample.appId === app.appId,
      ),
    ).toBe(true);

    // The insert is what unblocks the consumer's ack.
    await waitForConsumerAck("clickhouse-metrics", first.seq);

    // A redelivery of the identical batch collapses under FINAL.
    const second = await publishSamples(samples);
    await waitForConsumerAck("clickhouse-metrics", second.seq);
    expect(await listClickHouseMetricSamplesForEvent(eventId)).toHaveLength(samples.length);
  }, 20000);

  it("truncates the metrics store on clear", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const samples = samplesFor(app, eventId);
    const published = await publishSamples(samples);
    // The consumer acks after the insert, so the rows exist before the clear.
    await waitForConsumerAck("clickhouse-metrics", published.seq);
    await waitFor(
      () => listClickHouseMetricSamplesForEvent(eventId),
      (rows) => rows.length === samples.length,
    );

    const response = await handleFetch(`${TEST_ORIGIN}/events/clear`, {
      method: "POST",
      headers: ADMIN_HEADERS,
    });
    expect(response.status).toBe(200);

    // The clear travels through NATS; the view is ordered ahead of the
    // truncate, so the rows disappearing proves the truncate was applied
    // (the same command truncates the events store) without waiting on a
    // global count that concurrent ingests keep non-zero.
    const remaining = await waitFor(
      () => listClickHouseMetricSamplesForEvent(eventId),
      (rows) => rows.length === 0,
    );
    expect(remaining).toHaveLength(0);
  }, 20000);
});
