import { connect, type NatsConnection } from "@nats-io/transport-node";
import {
  AckPolicy,
  DeliverPolicy,
  jetstream,
  jetstreamManager,
  type JetStreamManager,
  type ConsumerConfig,
} from "@nats-io/jetstream";
import { env } from "bun";

// The backend authenticates with its config user (the `AUTH` account, also
// the auth-callout service); the dev defaults match docker-compose and are
// expected to be overridden in production.
const NATS_AUTH_USER = env.NATS_AUTH_USER || "sentries-auth";
const NATS_AUTH_PASSWORD = env.NATS_AUTH_PASSWORD || "sentries-dev-auth-pass";

export const EVENTS_SUBJECT_PREFIX = "sentry.events";
// A publish without the app token fails at the server: the stream and every
// `sentry.events` consumer filter the one-token shard.
export const EVENTS_STREAM_SUBJECT = `${EVENTS_SUBJECT_PREFIX}.*`;
export const METRICS_SUBJECT = "sentry.metrics";
export const FLAG_CHANGE_SUBJECT = "sentry.flags.changed";

/** The live-feed subject of one app shard. */
export function eventsSubject(appNumber: number): string {
  return `${EVENTS_SUBJECT_PREFIX}.${appNumber}`;
}

export const STREAM_NAME = "SENTRIES";
// The side-effects and the flags consumers have their own durable, so a
// test run does not compete with a running deployment for the messages.
export const SIDE_EFFECTS_CONSUMER =
  env.NATS_SIDE_EFFECTS_CONSUMER || "side-effects";
export const FLAGS_CONSUMER = env.NATS_FLAGS_CONSUMER || "flags-consumer";

// The stream's durable pull consumers: ClickHouse attaches its engine
// tables to them by name.
const PULL_CONSUMERS: Array<{
  name: string;
  subject: string;
  deliverPolicy?: DeliverPolicy;
}> = [
  { name: "clickhouse-events", subject: EVENTS_STREAM_SUBJECT },
  { name: "clickhouse-metrics", subject: METRICS_SUBJECT },
  // A fresh consumer must not replay the whole stream.
  {
    name: SIDE_EFFECTS_CONSUMER,
    subject: EVENTS_STREAM_SUBJECT,
    deliverPolicy: DeliverPolicy.New,
  },
  {
    name: FLAGS_CONSUMER,
    subject: FLAG_CHANGE_SUBJECT,
    deliverPolicy: DeliverPolicy.New,
  },
];

const INIT_ATTEMPTS = Number(env.INIT_RETRY_ATTEMPTS) || 5;
const INIT_RETRY_DELAY_MS = Number(env.INIT_RETRY_DELAY_MS) || 1000;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The stream's disk is bounded: a flood (or a long outage) fills it and the
// publish fails with a 503 instead of growing the disk without limit. The
// SDKs retry the 503, so the backpressure reaches the sender.
const STREAM_MAX_BYTES =
  Number(env.NATS_STREAM_MAX_BYTES) || 1024 * 1024 * 1024;

async function ensureStream(manager: JetStreamManager): Promise<void> {
  const subjects = [
    EVENTS_STREAM_SUBJECT,
    METRICS_SUBJECT,
    FLAG_CHANGE_SUBJECT,
  ];
  const info = await manager.streams.info(STREAM_NAME).catch(() => null);
  if (!info) {
    await manager.streams.add({
      name: STREAM_NAME,
      subjects,
      max_bytes: STREAM_MAX_BYTES,
    });
    console.log(`[NATS] Created ${STREAM_NAME} stream`);
    return;
  }
  const current = info.config.subjects ?? [];
  const missing = subjects.filter((subject) => !current.includes(subject));
  if (missing.length > 0 || (info.config.max_bytes ?? 0) < STREAM_MAX_BYTES) {
    await manager.streams.update(STREAM_NAME, {
      ...info.config,
      subjects: [...current, ...missing],
      max_bytes: STREAM_MAX_BYTES,
    });
  }
}

async function ensurePullConsumers(manager: JetStreamManager): Promise<void> {
  for (const { name, subject, deliverPolicy } of PULL_CONSUMERS) {
    const config: ConsumerConfig = {
      durable_name: name,
      ack_policy: AckPolicy.Explicit,
      filter_subject: subject,
      ...(deliverPolicy ? { deliver_policy: deliverPolicy } : {}),
    };
    const existing = await manager.consumers
      .info(STREAM_NAME, name)
      .catch(() => null);
    // An existing durable keeps its deliver policy; only the shard filter
    // is migrated in place.
    if (existing) {
      if (existing.config.filter_subject !== config.filter_subject) {
        await manager.consumers.update(STREAM_NAME, name, {
          ...existing.config,
          filter_subject: config.filter_subject,
        } as ConsumerConfig);
      }
      continue;
    }
    await manager.consumers.add(STREAM_NAME, config);
    console.log(`[NATS] Created durable pull consumer ${name}`);
  }
}

// Boot order: NATS first (stream + durable pull consumers), then
// ClickHouse. Retries, then fails fast — the backend never runs without
// its services.
async function initNats(): Promise<NatsConnection> {
  let connection: NatsConnection | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      const nc = await connect({
        servers: env.NATS_SERVERS,
        user: NATS_AUTH_USER,
        pass: NATS_AUTH_PASSWORD,
      });
      try {
        const manager = await jetstreamManager(nc);
        await ensureStream(manager);
        await ensurePullConsumers(manager);
      } catch (err) {
        await nc.close().catch(() => {});
        throw err;
      }
      connection = nc;
      return nc;
    } catch (err) {
      if (attempt >= INIT_ATTEMPTS) throw err;
      console.error(
        `[init] NATS attempt ${attempt}/${INIT_ATTEMPTS} failed: ${describe(err)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAY_MS));
    }
  }
}

export const nats = await initNats();
export const jetstream2 = jetstream(nats);

export const publishEvents = async (appNumber: number, events: Uint8Array[]) => {
  if (events.length === 0) return;
  const subject = eventsSubject(appNumber);
  const totalLength = events.reduce((acc, curr) => acc + curr.length, 0);
  const payload = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of events) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  await jetstream2.publish(subject, payload, { timeout: 2000 });
}

export async function publishMetricSamples(
  samples: Uint8Array[],
): Promise<void> {
  if (samples.length === 0) return;
  const totalLength = samples.reduce((acc, curr) => acc + curr.length, 0);
  const payload = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of samples) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  await jetstream2.publish(METRICS_SUBJECT, payload, { timeout: 2000 });
}

export async function publishFlagChangeEvent(event: {
  type: string;
  flagKey: string;
  flag?: unknown;
  origin?: string;
}): Promise<void> {
  await jetstream2.publish(
    FLAG_CHANGE_SUBJECT,
    new TextEncoder().encode(JSON.stringify(event)),
    { timeout: 2000 },
  );
}

// The SSE fan-out is per-process, so the other instances' changes arrive here.
export async function consumeFlagChanges(
  handler: (event: {
    type: string;
    flagKey: string;
    flag?: unknown;
    origin?: string;
  }) => void,
): Promise<void> {
  const consumer = await jetstream2.consumers.get(STREAM_NAME, FLAGS_CONSUMER);
  for await (const message of await consumer.consume()) {
    try {
      handler(
        JSON.parse(message.string()) as { type: string; flagKey: string },
      );
    } catch (err) {
      console.error(
        "[flags] Failed to handle the change event:",
        err instanceof Error ? err.message : err,
      );
    }
    message.ack();
  }
}
