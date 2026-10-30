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
} from "@nats-io/jetstream";
import { env } from "bun";
import { internalError } from "./errors";

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

const nats = await connect({
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
