/**
 * Batch-0 smoke test for the ingestion path planned in todo.metrics.md:
 * ClickHouse consumes NATS JetStream **by configuration** — a NATS table
 * engine + durable pull consumer + materialized view — and acknowledges a
 * message only after the insert lands.
 *
 *   docker compose up -d nats clickhouse
 *   bun scripts/smoke-ch-nats.ts
 *
 * Env overrides:
 *   NATS_SERVERS          NATS URL for this script (default nats://localhost:4222)
 *   CLICKHOUSE_NATS_URL   NATS host:port for the *ClickHouse server*
 *                         (default nats:4222 — the compose/CI service name)
 *   CLICKHOUSE_HOST/PORT/DATABASE/USER/PASSWORD (same defaults as the backend)
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { AckPolicy, StorageType, connect } from "../backend/nats.ts";
import type { JetStreamManager, NatsConnection } from "../backend/nats.ts";

const NATS_SERVERS = process.env.NATS_SERVERS || "nats://localhost:4222";
const CH_NATS_URL = process.env.CLICKHOUSE_NATS_URL || "nats:4222";
const CLICKHOUSE_URL = `http://${process.env.CLICKHOUSE_HOST || "localhost"}:${process.env.CLICKHOUSE_PORT || "8123"}`;
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "default";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";

const STREAM = "SENTRIES_SMOKE";
const SUBJECT = "smoke.events";
const CONSUMER = "clickhouse-smoke";
const QUEUE = `${CLICKHOUSE_DATABASE}.smoke_queue`;
const SINK = `${CLICKHOUSE_DATABASE}.smoke_sink`;
const SINK_MV = `${CLICKHOUSE_DATABASE}.smoke_sink_mv`;

const EVENT_ID = `smoke-${crypto.randomUUID()}`;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function log(step: string): void {
  console.log(`[smoke] ${step}`);
}

async function waitFor(
  label: string,
  timeoutMs: number,
  check: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
      lastError = undefined;
    } catch (err) {
      // Auth/config failures will not heal with retries.
      if (/Authentication failed|REQUIRED_PASSWORD/.test(describe(err))) throw err;
      lastError = err;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}${lastError ? ` (last error: ${describe(lastError)})` : ""}`,
  );
}

async function dropSmokeTables(clickhouse: ClickHouseClient): Promise<void> {
  for (const table of [SINK_MV, SINK, QUEUE]) {
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${table}` }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const clickhouse = createClient({
    url: CLICKHOUSE_URL,
    username: CLICKHOUSE_USER,
    password: CLICKHOUSE_PASSWORD,
    request_timeout: 15_000,
  });
  let nc: NatsConnection | undefined;
  let manager: JetStreamManager | undefined;

  try {
    log(`waiting for ClickHouse at ${CLICKHOUSE_URL}`);
    await waitFor("ClickHouse", 60_000, async () => {
      const result = await clickhouse.query({ query: "SELECT 1", format: "JSONEachRow" });
      return (await result.json()).length === 1;
    });

    log(`connecting to NATS at ${NATS_SERVERS}`);
    nc = await connect({ servers: NATS_SERVERS });
    const jsm = await nc.jetstreamManager();
    manager = jsm;

    await jsm.streams.delete(STREAM).catch(() => {});
    await jsm.streams.add({ name: STREAM, subjects: [SUBJECT], storage: StorageType.File });
    await jsm.consumers.add(STREAM, {
      durable_name: CONSUMER,
      ack_policy: AckPolicy.Explicit,
      filter_subject: SUBJECT,
    });
    log(`stream ${STREAM} with durable pull consumer ${CONSUMER} ready`);

    await dropSmokeTables(clickhouse);
    await clickhouse.command({
      query: `
        CREATE TABLE ${QUEUE} (id String, value UInt64, type String)
        ENGINE = NATS
        SETTINGS nats_url = '${CH_NATS_URL}',
                 nats_stream = '${STREAM}',
                 nats_consumer_name = '${CONSUMER}',
                 nats_subjects = '${SUBJECT}',
                 nats_format = 'JSONEachRow',
                 input_format_skip_unknown_fields = 1,
                 nats_skip_broken_messages = 10
      `,
    });
    await clickhouse.command({
      query: `
        CREATE TABLE ${SINK} (id String, value UInt64, type String, receivedAt DateTime DEFAULT now())
        ENGINE = ReplacingMergeTree()
        ORDER BY id
        SETTINGS fsync_after_insert = 1, fsync_part_directory = 1
      `,
    });
    await clickhouse.command({
      query: `
        CREATE MATERIALIZED VIEW ${SINK_MV} TO ${SINK}
        AS SELECT id, value, type, now() AS receivedAt FROM ${QUEUE} WHERE type != 'clear'
      `,
    });
    log("ClickHouse NATS engine table and materialized view created");

    const payload = new TextEncoder().encode(
      JSON.stringify({ id: EVENT_ID, value: 42, type: "envelope" }),
    );
    await nc.jetstream().publish(SUBJECT, payload);
    log(`published ${EVENT_ID} to ${SUBJECT}`);

    await waitFor("the event in ClickHouse", 30_000, async () => {
      const result = await clickhouse.query({
        query: `SELECT id, value FROM ${SINK} FINAL WHERE id = {id:String}`,
        format: "JSONEachRow",
        query_params: { id: EVENT_ID },
      });
      const rows = await result.json<{ id: string; value: number | string }>();
      return rows.length === 1 && Number(rows[0]?.value) === 42;
    });
    log("event landed in ClickHouse");

    await waitFor("the JetStream acknowledgement", 15_000, async () => {
      const info = await jsm.consumers.info(STREAM, CONSUMER);
      return info.delivered.stream_seq >= 1 && info.num_ack_pending === 0;
    });
    const info = await jsm.consumers.info(STREAM, CONSUMER);
    log(
      `consumer acked after the insert: delivered sequence ${info.delivered.stream_seq}, ` +
        `ack floor ${info.ack_floor.stream_seq}, pending ${info.num_ack_pending}`,
    );

    console.log("\n✔ ClickHouse consumed NATS JetStream by configuration and acked after the insert");
  } finally {
    await dropSmokeTables(clickhouse);
    await manager?.streams.delete(STREAM).catch(() => {});
    await nc?.close().catch(() => {});
    await clickhouse.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[smoke] FAILED: ${describe(err)}`);
  process.exit(1);
});
