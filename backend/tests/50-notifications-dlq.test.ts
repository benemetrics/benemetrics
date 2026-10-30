/**
 * Admin API test: the notification DLQ lives in JetStream, not Postgres.
 *
 * Entries are published directly to the `snotify.dlq` stream (a terminal
 * delivery failure would republish there via the worker), then the admin
 * endpoints list and dismiss them. DELETE is idempotent.
 */

import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import { connect } from "@nats-io/transport-node";
import { jetstreamManager } from "@nats-io/jetstream";
import {
  ADMIN_HEADERS,
  handleFetch,
  TEST_ORIGIN,
} from "./test-helpers";
import { NOTIFY_DLQ_STREAM, NOTIFY_DLQ_SUBJECT } from "../nats";

let nats: NatsConnection | null = null;
let jsm: Awaited<ReturnType<typeof jetstreamManager>> | null = null;

beforeAll(async () => {
  nats = await connect({
    servers: process.env.NATS_SERVERS || "nats://localhost:4222",
    user: process.env.NATS_AUTH_USER || "sentries-auth",
    pass: process.env.NATS_AUTH_PASSWORD || "sentries-dev-auth-pass",
  });
  jsm = await jetstreamManager(nats);
  // The backend's boot (via test-helpers) already ensured the DLQ stream
  // topology; this publish path needs the stream to exist.
});

afterAll(async () => {
  await nats?.close();
});

function publishDeadLetter(entry: {
  notification: Record<string, unknown>;
  channel: Record<string, unknown>;
  attempts: number;
  error: string;
  failedAt: string;
}) {
  return jsm!.jetstream().publish(
    NOTIFY_DLQ_SUBJECT,
    new TextEncoder().encode(JSON.stringify(entry)),
  );
}

describe("Admin: notification DLQ", () => {
  it("lists DLQ entries newest-first and dismisses one by seq", async () => {
    const now = new Date().toISOString();

    const a = await publishDeadLetter({
      notification: { title: "First" },
      channel: { id: "c1", name: "webhook", type: "webhook", config: {} },
      attempts: 3,
      error: "connection refused",
      failedAt: now,
    });
    const b = await publishDeadLetter({
      notification: { title: "Second" },
      channel: { id: "c2", name: "slack", type: "slack", config: {} },
      attempts: 5,
      error: "rate limited",
      failedAt: now,
    });

    const seqA = a.seq;
    const seqB = b.seq;

    // List: newest first → b then a.
    const listRes = await handleFetch(
      `${TEST_ORIGIN}/api/admin/notifications/dlq`,
      { headers: ADMIN_HEADERS },
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { data: Array<{ seq: number }> };
    expect(list.data.map((e) => e.seq)).toEqual([seqB, seqA]);

    // Dismiss the newer one (seqB).
    const dismissRes = await handleFetch(
      `${TEST_ORIGIN}/api/admin/notifications/dlq/${seqB}`,
      { method: "DELETE", headers: ADMIN_HEADERS },
    );
    expect(dismissRes.status).toBe(200);
    expect((await dismissRes.json()) as { dismissed: boolean }).toEqual({
      dismissed: true,
    });

    // Dismissing again is idempotent → false.
    const again = await handleFetch(
      `${TEST_ORIGIN}/api/admin/notifications/dlq/${seqB}`,
      { method: "DELETE", headers: ADMIN_HEADERS },
    );
    expect((await again.json()) as { dismissed: boolean }).toEqual({
      dismissed: false,
    });

    // The list no longer contains seqB.
    const list2 = (await (await handleFetch(
      `${TEST_ORIGIN}/api/admin/notifications/dlq`,
      { headers: ADMIN_HEADERS },
    )).json()) as { data: Array<{ seq: number }> };
    expect(list2.data.map((e) => e.seq)).toEqual([seqA]);
  });

  it("answers an empty list when the DLQ has no entries", async () => {
    const res = await handleFetch(
      `${TEST_ORIGIN}/api/admin/notifications/dlq`,
      { headers: ADMIN_HEADERS },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
