import { connect, JetStreamClient, ConsumerConfig, JSONCodec } from "nats.ws";
import { dispatchIngestedEvent } from "./events-consumer.ts";

let nc: any = null;
let js: JetStreamClient | null = null;
const jsonCodec = JSONCodec();

export async function initNats(): Promise<void> {
  const servers = process.env.NATS_SERVERS || "nats://localhost:4222";
  const stream = process.env.NATS_STREAM || "SENTRIES";

  nc = await connect({ servers });
  js = nc.jetstream();

  // Create stream
  await js.streams.add({ name: stream, subjects: ["sentry.events", "sentry.metrics", "sentry.flags.changed"] });

  // Create durable pull consumers for ClickHouse
  await createConsumer("clickhouse-events", "sentry.events");
  await createConsumer("clickhouse-metrics", "sentry.metrics");

  // Start side-effects consumer
  await startEventsConsumer();

  console.log("NATS initialized");
}

async function createConsumer(consumerName: string, subject: string): Promise<void> {
  if (!js) return;
  try {
    await js.consumers.add(process.env.NATS_STREAM || "SENTRIES", {
      durable_name: consumerName,
      filter_subject: subject,
      ack_policy: "explicit",
      deliver_policy: "all",
      ack_wait: 30000,
      max_deliver: 10,
    } as any);
    console.log(`Created consumer ${consumerName} for ${subject}`);
  } catch (err) {
    console.error(`Failed to create consumer ${consumerName}:`, err);
  }
}

export async function dispatchIngestedEvent(message: {
  id: string;
  projectId: string;
  appId: string;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
  type: string;
}): Promise<void> {
  if (!js) {
    throw new Error("NATS not initialized");
  }

  const subject = "sentry.events";
  const payload = jsonCodec.encode(message);

  try {
    await js.publish(subject, payload);
  } catch (err) {
    console.error("Failed to publish to NATS:", err);
    throw new Error("NATS publish failed");
  }
}

export async function publishFlagChange(flagKey: string): Promise<void> {
  if (!js) throw new Error("NATS not initialized");
  await js.publish("sentry.flags.changed", jsonCodec.encode({ flagKey, timestamp: new Date().toISOString() }));
}

export async function startEventsConsumer(): Promise<void> {
  if (!js) return;

  const consumer = await js.consumers.get("SENTRIES", "clickhouse-events");
  if (!consumer) return;

  for await (const msg of consumer) {
    try {
      const data = jsonCodec.decode(msg.data);
      await dispatchIngestedEvent(data);
      msg.ack();
    } catch (err) {
      console.error("Error processing message:", err);
      msg.nak();
    }
  }
}

export function isNatsConnected(): boolean {
  return nc !== null && !nc.closed;
}