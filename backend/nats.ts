import { connect, type JetStreamClient, type JetStreamManager } from "nats";
import { startEventsConsumer, startLiveConsumer } from "./events-consumer";
import { startReleasesConsumer } from "./releases-consumer";

const NATS_SERVERS = process.env.NATS_SERVERS || "nats://localhost:4222";

const STREAM_NAME = "SENTRIES";
export const SUBJECT = "sentry.events";
const FLAG_CHANGE_SUBJECT = "sentry.flags.changed";

export interface SentryEventMessage {
  id: string;
  projectId: string;
  // Resolved app the event was ingested through.
  appId?: string;
  envelopeHeader: string;
  envelopeItems: string;
  raw: string;
  receivedAt: string;
  type: "envelope" | "store" | "clear";
}

export interface FlagChangeMessage {
  type: "create" | "update" | "status" | "delete";
  flagKey: string;
  flag?: unknown;
}

let natsClient: Awaited<ReturnType<typeof connect>> | null = null;

// NATS is optional: when it is unavailable the backend keeps working,
// ingestion falls back to writing Postgres in the request path and
// release tracking runs in-process (see releases-consumer.ts).
let client: JetStreamClient | null = null;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isNatsConnected(): boolean {
  return client !== null;
}

// NATS-first publishing: returns false when the broker is unavailable,
// so the caller can fall back to persisting the event synchronously.
export async function publishEvent(event: SentryEventMessage): Promise<boolean> {
  if (!client) return false;
  try {
    await client.publish(SUBJECT, new TextEncoder().encode(JSON.stringify(event)), {
      timeout: 2000,
    });
    return true;
  } catch (err) {
    console.error("[NATS] Failed to publish event:", describe(err));
    return false;
  }
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

export async function initNats(): Promise<void> {
  try {
    const nc = await connect({ servers: NATS_SERVERS });
    natsClient = nc;
    const manager: JetStreamManager = await nc.jetstreamManager();
    client = nc.jetstream();

    try {
      await manager.streams.info(STREAM_NAME);
    } catch {
      await manager.streams.add({ name: STREAM_NAME, subjects: [SUBJECT] });
      console.log(`[NATS] Created ${STREAM_NAME} stream`);
    }

    startEventsConsumer(client);
    startLiveConsumer(client);
    startReleasesConsumer(client);
    console.log("[NATS] Connected to JetStream");
  } catch (err) {
    console.error("[NATS] Failed to connect:", describe(err));
    await natsClient?.close().catch(() => {});
    client = null;
    natsClient = null;
  }
}

export async function closeNats(): Promise<void> {
  const nc = natsClient;
  natsClient = null;
  client = null;
  if (nc) await nc.close();
}
