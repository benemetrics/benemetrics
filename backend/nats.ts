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

export const TOPICS = {
  EVENTS: "benemetrics.events",
  METRICS: "benemetrics.metrics",
  FLAGS_CHANGED: "flags.changed",
  FLAGS_PING: "flags.ping",
  NOTIFY: "snotify.deliver",
  NOTIFY_DLQ: "snotify.dlq",
}

export const CONSUMERS = {
  EVENTS: "benemetrics.backend-consumer.events",
  NOTIFICATIONS: "benemetrics.backend-consumer.notifications",
}

export const STREAMS = {
  CONSUMERS: "CONSUMERS",
  QUEUE: "QUEUE",
  DLQ: "DLQ",
}

export const nats = await connect({
  servers: env.NATS_SERVERS,
  user: env.NATS_AUTH_USER,
  pass: env.NATS_AUTH_PASSWORD,
});

export const manager = await jetstreamManager(nats);

// CONSUMERS
const x= await manager.streams.add({
  name: 'CONSUMERS',
  subjects: [TOPICS.EVENTS, TOPICS.METRICS],
  allow_batched: true,
  retention: RetentionPolicy.Interest,
});

// QUEUE
await manager.streams.add({
  name: "QUEUE",
  subjects: [TOPICS.NOTIFY],
  retention: RetentionPolicy.Workqueue,
  max_age: 24 * 60 * 60 * 1_000_000_000,
  allow_atomic: true,
  allow_batched: true,
});

// DLQ
await manager.streams.add({
  name: 'DLQ',
  allow_direct: true,
  subjects: ["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.>", TOPICS.NOTIFY_DLQ],
  retention: RetentionPolicy.Limits,
  max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
});


export const natsStream = manager.jetstream();

export const events = new Bucket(TOPICS.EVENTS);

export const metrics = new Bucket(TOPICS.METRICS);
