/**
 * Hop 2 (metrics) — `sentry.metrics` -> ClickHouse.
 *
 * Samples are published as JSONEachRow (one sample per line): the NATS
 * engine table + materialized view insert them, the durable consumer
 * acknowledges only after the insert, and a redelivered batch collapses
 * in ReplacingMergeTree under FINAL reads.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import { jetstream as createJetstream, type JetStreamClient } from "@nats-io/jetstream";
import { listClickHouseMetricSamplesForEvent } from "../clickhouse";
import type { MetricSample } from "../protocol/metrics";
import {
  connectTestNats,
  startTestApp,
  TEST_METRICS_SUBJECT,
  waitFor,
  waitForConsumerAck,
} from "./test-helpers";

let nats: NatsConnection;
let jetstream: JetStreamClient;

beforeAll(async () => {
  nats = await connectTestNats();
  jetstream = createJetstream(nats);
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
    { projectId: app.projectId, appId: app.appId, eventId, metric: "event_count", value: 1, dimension: "GET /metrics", tags: {}, receivedAt },
    { projectId: app.projectId, appId: app.appId, eventId, metric: "lcp", value: 2400, dimension: "GET /metrics", tags: {}, receivedAt },
    { projectId: app.projectId, appId: app.appId, eventId, metric: "frames_total", value: 120, dimension: "HomeScreen", tags: {}, receivedAt },
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
});
