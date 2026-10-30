import { connect } from "@nats-io/transport-node";
import {
  AckPolicy,
  DeliverPolicy,
  jetstream,
  jetstreamManager,
  type JetStreamManager,
  type ConsumerConfig,
  type Batch,
  RetentionPolicy,
  type StreamConfig,
} from "@nats-io/jetstream";
import { env } from "bun";
import { internalError } from "./errors";
import type {
  NotificationDeadLetter,
  NotificationDelivery,
} from "./protocol/notifications";

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

// Notifications: the broker is their only delivery channel. Two streams —
// each stream's sequence is per stream, so a DLQ entry is dismissable by
// `seq` without consumer bookkeeping.
export const NOTIFY_STREAM = env.NOTIFY_STREAM || "NOTIFICATIONS";
export const NOTIFY_DLQ_STREAM = env.NOTIFY_DLQ_STREAM || "NOTIFY-DLQ";
export const NOTIFY_DELIVER_SUBJECT = "snotify.deliver";
export const NOTIFY_DLQ_SUBJECT = "snotify.dlq";
export const NOTIFY_WORKER_CONSUMER =
  env.NOTIFY_WORKER_CONSUMER || "notification-worker";
export const NOTIFY_MAX_DELIVER = Number(env.NOTIFY_MAX_DELIVER) || 5;
const NOTIFY_DELIVER_MAX_AGE_NS = 24 * 60 * 60 * 1_000_000_000;
const NOTIFY_DLQ_MAX_AGE_NS =
  (Number(env.NOTIFY_DLQ_MAX_AGE_DAYS) || 7) * 24 * 60 * 60 * 1_000_000_000;

// The stream's durable pull consumers: ClickHouse attaches its engine
// tables to them by name.
const PULL_CONSUMERS: Array<{
  name: string;
  subject: string;
  deliverPolicy?: DeliverPolicy;
}> = [
  { name: "clickhouse-events", subject: EVENTS_STREAM_SUBJECT },
  { name: "clickhouse-metrics", subject: METRICS_SUBJECT },
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

export const nats = await connect({
  servers: env.NATS_SERVERS,
  user: NATS_AUTH_USER,
  pass: NATS_AUTH_PASSWORD,
});

const manager = await jetstreamManager(nats);

await manager.streams.add({
  name: STREAM_NAME,
  subjects: [EVENTS_SUBJECT_PREFIX, METRICS_SUBJECT],
  allow_batched: true,
  retention: RetentionPolicy.Interest,
});

await ensureNotificationTopology(manager);

const natsStream = manager.jetstream();

class Bucket {
  private topic = "";
  private buckets = Array.from({ length: 10 }).map(this.createBucket);
  private bucket = this.buckets[0]!;

  constructor(topic: string) {
    this.topic = topic;
    setInterval(this.commit, 100);
  }

  private createBucket() { 
    return { ...Promise.withResolvers(), buffer: [] as any[], isCommiting: false };
  };

  private commit = async () => {
    let bucket = this.bucket;

    try {
      bucket.isCommiting = true;
      bucket.resolve(await natsStream.publish(this.topic, bucket.buffer.map((event) => JSON.stringify(event)).join('\n')));
    } catch (error) {
      bucket.reject(error);
    } finally {
      bucket = this.createBucket();
    }
  }

  private async getAvailableBucket(): Promise<Bucket['buckets'][number]> {
    const bucket = this.buckets.find(({ isCommiting }) => !isCommiting);
    if (bucket) return this.bucket = bucket;
    await Bun.sleep(100);
    return await this.getAvailableBucket();
  }

  async push(data: any): Promise<unknown> {
    if (this.bucket.isCommiting) await this.getAvailableBucket();
    this.bucket.buffer.push(data);
    return this.bucket.promise;
  }
}

export const events = new Bucket(EVENTS_STREAM_SUBJECT);

export const metrics = new Bucket(METRICS_SUBJECT);

export async function consumeFlagChanges(
  handler: (event: {
    type: string;
    flagKey: string;
    flag?: unknown;
    origin?: string;
  }) => void,
): Promise<void> {
  const consumer = await natsStream.consumers.get(STREAM_NAME, FLAGS_CONSUMER);
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

// Notification topology — see docs/nats.md §1b. The deliver stream is a work
// queue (ack removes the message), the DLQ stream keeps entries until they
// are dismissed or the retention expires.
export async function ensureNotificationTopology(
  jsm: JetStreamManager,
): Promise<void> {
  const createStream = async (
    cfg: Partial<StreamConfig> & { name: string },
  ): Promise<void> => {
    const info = await jsm.streams.info(cfg.name).catch(() => null);
    if (info) return;
    await jsm.streams.add(cfg);
    console.log(`[NATS] Created ${cfg.name} stream`);
  };
  await createStream({
    name: NOTIFY_STREAM,
    subjects: [NOTIFY_DELIVER_SUBJECT],
    retention: RetentionPolicy.Workqueue,
    max_age: NOTIFY_DELIVER_MAX_AGE_NS,
  });
  await createStream({
    name: NOTIFY_DLQ_STREAM,
    subjects: [NOTIFY_DLQ_SUBJECT],
    retention: RetentionPolicy.Limits,
    max_age: NOTIFY_DLQ_MAX_AGE_NS,
  });
  const consumer = await jsm.consumers
    .info(NOTIFY_STREAM, NOTIFY_WORKER_CONSUMER)
    .catch(() => null);
  if (!consumer) {
    await jsm.consumers.add(NOTIFY_STREAM, {
      durable_name: NOTIFY_WORKER_CONSUMER,
      ack_policy: AckPolicy.Explicit,
      filter_subject: NOTIFY_DELIVER_SUBJECT,
      max_deliver: NOTIFY_MAX_DELIVER,
    });
    console.log(`[NATS] Created durable pull consumer ${NOTIFY_WORKER_CONSUMER}`);
  }
}

export const natsManager = manager;
// `consumer.ts` imports `jetstream2`; it is the same JetStreamManager used to
// create/pull the side-effects durable consumer.
export const jetstream2 = natsManager;

export async function publishNotificationDelivery(
  entry: NotificationDelivery,
): Promise<void> {
  await natsStream.publish(
    NOTIFY_DELIVER_SUBJECT,
    new TextEncoder().encode(JSON.stringify(entry)),
  );
}

/** Reads the DLQ newest-first; `seq` is the dismiss handle. */
export async function listDeadLetters(
  limit = 50,
): Promise<NotificationDeadLetter[]> {
  const info = await manager.streams.info(NOTIFY_DLQ_STREAM).catch(() => null);
  if (!info) return [];
  const entries: NotificationDeadLetter[] = [];
  const lastSeq = info.state.last_seq;
  const firstSeq = info.state.first_seq;
  for (let seq = lastSeq; seq >= firstSeq && entries.length < limit; seq--) {
    const msg = await manager.streams
      .getMessage(NOTIFY_DLQ_STREAM, { seq })
      .catch(() => null);
    if (!msg || msg.data.length === 0) continue;
    try {
      const payload = JSON.parse(
        new TextDecoder().decode(msg.data),
      ) as Omit<NotificationDeadLetter, "seq">;
      entries.push({ seq, ...payload });
    } catch {
      // An unparsable entry is skipped, never a reason to fail the list.
    }
  }
  return entries;
}

/** Removes one DLQ message; `false` = the seq was already gone. */
export async function dismissDeadLetter(seq: number): Promise<boolean> {
  try {
    return await manager.streams.deleteMessage(NOTIFY_DLQ_STREAM, seq);
  } catch {
    return false;
  }
}

/** A terminal delivery failure republished into the DLQ stream. */
export async function publishDeadLetter(
  entry: Omit<NotificationDeadLetter, "seq">,
): Promise<void> {
  await natsStream.publish(
    NOTIFY_DLQ_SUBJECT,
    new TextEncoder().encode(JSON.stringify(entry)),
  );
}
