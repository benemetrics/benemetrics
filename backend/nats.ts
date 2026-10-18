import { AckPolicy, connect, type JetStreamClient, type JetStreamManager } from "nats";
import { startEventsConsumer } from "./events-consumer";
import { startReleasesConsumer } from "./releases-consumer";
import { retryInit } from "./retry";
import type { MetricSample } from "./protocol/metrics";

const NATS_SERVERS = process.env.NATS_SERVERS || "nats://localhost:4222";

const STREAM_NAME = "SENTRIES";
export const SUBJECT = "sentry.events";
export const METRICS_SUBJECT = "sentry.metrics";
const FLAG_CHANGE_SUBJECT = "sentry.flags.changed";

// ClickHouse consumes the stream through its own durable pull consumers
// (the NATS table engine references them by name); they are provisioned
// here before ClickHouse attaches its engine tables at boot.
const PULL_CONSUMERS: Array<{ name: string; subject: string }> = [
  { name: "clickhouse-events", subject: SUBJECT },
  { name: "clickhouse-metrics", subject: METRICS_SUBJECT },
];

// Side-effect consumers: production keeps one durable per consumer so an
// instance restart resumes where it stopped. Tests must never share them:
// each test process applies every event to its own database, so a shared
// durable would let one process steal another's messages (and a second
// binder would fail on a bound push consumer). Test consumers are named
// per process and deleted on shutdown.
const IS_TEST = process.env.NODE_ENV === "test";
const TEST_CONSUMER_ID = crypto.randomUUID().slice(0, 8);

export const EVENTS_CONSUMER = IS_TEST
  ? `sentry-events-consumer-test-${TEST_CONSUMER_ID}`
  : "sentry-events-consumer";
export const RELEASES_CONSUMER = IS_TEST
  ? `sentry-releases-consumer-test-${TEST_CONSUMER_ID}`
  : "sentry-releases-consumer";

export interface SentryEventMessage {
  id: string;
  projectId: string;
  // Resolved app the event was ingested through.
  appId?: string;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
  type: "envelope" | "store" | "clear";
}

export interface FlagChangeMessage {
  type: "create" | "update" | "status" | "delete";
  flagKey: string;
  flag?: unknown;
}

let natsClient: Awaited<ReturnType<typeof connect>> | null = null;
let client: JetStreamClient | null = null;

// Publishes one ingested event. The broker is required — there is no
// in-process fallback — so a failure throws and the caller answers 503;
// at-least-once delivery comes from JetStream.
export async function publishEvent(event: SentryEventMessage): Promise<void> {
  if (!client) throw new Error("NATS is not connected");
  await client.publish(SUBJECT, new TextEncoder().encode(JSON.stringify(event)), {
    timeout: 2000,
  });
}

// Publishes the samples extracted from one envelope as JSONEachRow — the
// ClickHouse NATS engine inserts one row per line. Empty sample lists are
// a no-op; like the event publish, a failure throws and the caller
// answers 503.
export async function publishMetricSamples(samples: MetricSample[]): Promise<void> {
  if (samples.length === 0) return;
  if (!client) throw new Error("NATS is not connected");
  const payload = samples.map((sample) => JSON.stringify(sample)).join("\n");
  await client.publish(METRICS_SUBJECT, new TextEncoder().encode(payload), {
    timeout: 2000,
  });
}

export async function publishFlagChangeEvent(event: FlagChangeMessage): Promise<void> {
  if (!natsClient) return;
  try {
    await natsClient.publish(
      FLAG_CHANGE_SUBJECT,
      new TextEncoder().encode(JSON.stringify(event)),
    );
  } catch (err) {
    console.error("[NATS] Failed to publish flag change:", describe(err));
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function ensureStream(manager: JetStreamManager): Promise<void> {
  const subjects = [SUBJECT, METRICS_SUBJECT];
  try {
    const info = await manager.streams.info(STREAM_NAME);
    const current = info.config.subjects ?? [];
    const missing = subjects.filter((subject) => !current.includes(subject));
    if (missing.length > 0) {
      await manager.streams.update(STREAM_NAME, {
        ...info.config,
        subjects: [...current, ...missing],
      });
    }
  } catch {
    await manager.streams.add({ name: STREAM_NAME, subjects });
    console.log(`[NATS] Created ${STREAM_NAME} stream`);
  }
}

async function ensurePullConsumers(manager: JetStreamManager): Promise<void> {
  for (const { name, subject } of PULL_CONSUMERS) {
    try {
      await manager.consumers.info(STREAM_NAME, name);
      continue;
    } catch {
      // Not provisioned yet.
    }
    await manager.consumers.add(STREAM_NAME, {
      durable_name: name,
      ack_policy: AckPolicy.Explicit,
      filter_subject: subject,
    });
    console.log(`[NATS] Created durable pull consumer ${name}`);
  }
}

// Boot order: NATS first (stream + durable pull consumers), then
// ClickHouse. Retries, then fails fast — the backend never runs without
// its services.
export async function initNats(): Promise<void> {
  if (client) return;
  await retryInit("NATS", async () => {
    const nc = await connect({ servers: NATS_SERVERS });
    try {
      const jetstream = nc.jetstream();
      const manager = await nc.jetstreamManager();
      await ensureStream(manager);
      await ensurePullConsumers(manager);
      natsClient = nc;
      client = jetstream;
    } catch (err) {
      await nc.close().catch(() => {});
      throw err;
    }
  });
  if (!client) throw new Error("NATS is not connected");

  startEventsConsumer(client, EVENTS_CONSUMER);
  startReleasesConsumer(client, RELEASES_CONSUMER);
  console.log("[NATS] Connected to JetStream");
}

export async function closeNats(): Promise<void> {
  const nc = natsClient;
  natsClient = null;
  client = null;
  if (!nc) return;

  // Test consumers are per-process and must not outlive the process.
  if (IS_TEST) {
    try {
      const manager = await nc.jetstreamManager();
      await manager.consumers.delete(STREAM_NAME, EVENTS_CONSUMER).catch(() => {});
      await manager.consumers.delete(STREAM_NAME, RELEASES_CONSUMER).catch(() => {});
    } catch {
      // Best-effort cleanup; the connection is going away regardless.
    }
  }

  await nc.close();
}
