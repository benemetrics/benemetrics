/**
 * Hop 2 — NATS -> ClickHouse (engine configuration + ack path).
 *
 * This test owns the engine configuration: a message published straight
 * to JetStream is inserted by the NATS table engine + materialized view,
 * the durable consumer acknowledges it only after the insert, and a
 * redelivered id collapses in ReplacingMergeTree (FINAL reads).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import { jetstream as createJetstream, type JetStreamClient } from "@nats-io/jetstream";
import { listStoredEvents } from "../events-store";
import {
  connectTestNats,
  startTestApp,
  TEST_EVENTS_SUBJECT,
  waitForConsumerAck,
  waitForStoredEvent,
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

function publishEventMessage(message: Record<string, unknown>) {
  return jetstream.publish(TEST_EVENTS_SUBJECT, new TextEncoder().encode(JSON.stringify(message)));
}

describe("Hop 2: NATS -> ClickHouse", () => {
  it("inserts a directly published message and acknowledges after the insert", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const message = {
      id: eventId,
      projectId: app.projectId,
      appId: app.appId,
      envelopeHeader: JSON.stringify({ event_id: eventId }),
      envelopeItems: JSON.stringify([
        {
          header: { type: "event", length: 0 },
          payload: { event_id: eventId, message: "hop two", level: "error" },
        },
      ]),
      receivedAt: new Date().toISOString(),
      type: "store",
    };

    const first = await publishEventMessage(message);
    const stored = await waitForStoredEvent(eventId);
    expect(stored.projectId).toBe(app.projectId);
    expect(stored.appId).toBe(app.appId);
    expect(JSON.parse(stored.envelopeItems)[0].payload.message).toBe("hop two");

    // The insert is what unblocks the consumer's ack.
    await waitForConsumerAck("clickhouse-events", first.seq);

    // A redelivery of the identical message collapses under FINAL: the
    // project still holds exactly one row for the event id.
    const second = await publishEventMessage(message);
    await waitForConsumerAck("clickhouse-events", second.seq);

    const { data } = await listStoredEvents({
      projectId: app.projectId,
      limit: 100,
    });
    expect(data.filter((event) => event.id === eventId)).toHaveLength(1);
  });
});
