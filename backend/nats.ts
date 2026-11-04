import { connect } from "@nats-io/transport-node";
import {
  jetstreamManager,
  RetentionPolicy,
} from "@nats-io/jetstream";
import { env } from "bun";

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

const NATS_AUTH_USER = env.NATS_AUTH_USER || "sentries-auth";
const NATS_AUTH_PASSWORD = env.NATS_AUTH_PASSWORD || "sentries-dev-auth-pass";

export const EVENTS_SUBJECT = "sentry.events";
export const METRICS_SUBJECT = "sentry.metrics";
export const FLAG_CHANGE_SUBJECT = "flags.changed";
export const FLAG_PING = "flags.ping";


export const SIDE_EFFECTS_CONSUMER =
  env.NATS_SIDE_EFFECTS_CONSUMER || "side-effects";
export const FLAGS_CONSUMER = env.NATS_FLAGS_CONSUMER || "flags-consumer";
export const NOTIFY_MAX_DELIVER = Number(env.NOTIFY_MAX_DELIVER) || 5


export const nats = await connect({
  servers: env.NATS_SERVERS,
  user: NATS_AUTH_USER,
  pass: NATS_AUTH_PASSWORD,
});

export const manager = await jetstreamManager(nats);

// CONSUMERS
await manager.streams.add({
  name: 'CONSUMERS',
  subjects: ["sentry.events", "sentry.metrics"],
  allow_batched: true,
  retention: RetentionPolicy.Interest,
});

// QUEUE
await manager.streams.add({
  name: "QUEUE",
  subjects: ["snotify.deliver"],
  retention: RetentionPolicy.Workqueue,
  max_age: 24 * 60 * 60 * 1_000_000_000,
});

// DLQ
await manager.streams.add({
  name: 'DLQ',
  allow_direct: true,
  subjects: ["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.>"],
  retention: RetentionPolicy.Limits,
  max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
});


export const natsStream = manager.jetstream();

export const events = new Bucket("sentry.events");

export const metrics = new Bucket("sentry.metrics");
