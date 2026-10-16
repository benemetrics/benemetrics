import { consumerOpts, createInbox, type JetStreamClient } from "nats";
import { appDAO } from "db/dao/project";
import { releaseDAO } from "db/dao/releases";
import { extractRelease } from "./events/utils";
import type { ItemHeader } from "./protocol/item-header";
import type { SentryEventMessage } from "./nats";

const CONCURRENCY = 8;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Best-effort: messages without a release, without a resolvable app, or
// for deleted apps are skipped.
export async function processReleaseEvent(
  event: SentryEventMessage,
): Promise<void> {
  // Broadcast messages (e.g. "clear") carry no app to attach to.
  if (!event.appId || event.appId === "*" || event.type === "clear") {
    return;
  }

  let items: unknown;
  try {
    items = JSON.parse(event.envelopeItems);
  } catch {
    return;
  }

  const release = extractRelease({
    items: items as Array<{ header: ItemHeader; payload: unknown }>,
  });
  if (!release) return;

  const app = await appDAO.findById(event.appId);
  if (!app) return;

  // recordEvent skips redelivered events atomically, so at-least-once
  // delivery cannot double-count an event.
  await releaseDAO.recordEvent(event.appId, release, {
    eventId: event.id,
    at: event.receivedAt,
  });
}

export function startReleasesConsumer(jetstream: JetStreamClient): void {
  const run = async () => {
    try {
      const opts = consumerOpts();
      opts.durable("sentry-releases-consumer");
      opts.deliverTo(createInbox());
      opts.manualAck();
      opts.ackExplicit();

      const sub = await jetstream.subscribe("sentry.events", opts);
      const inflight = new Set<Promise<void>>();

      for await (const msg of sub) {
        const handle = async () => {
          let event: SentryEventMessage;
          try {
            event = JSON.parse(msg.string()) as SentryEventMessage;
          } catch (err) {
            console.error("[releases] Discarding malformed message:", describe(err));
            msg.ack();
            return;
          }

          try {
            await processReleaseEvent(event);
            msg.ack();
          } catch (err) {
            console.error("[releases] Failed to record release:", describe(err));
            msg.nak();
          }
        };

        const task = handle();
        inflight.add(task);
        void task.finally(() => {
          inflight.delete(task);
        });

        if (inflight.size >= CONCURRENCY) {
          await Promise.race(inflight);
        }
      }

      await Promise.allSettled(inflight);
    } catch (err) {
      console.error("[releases] Failed to start consumer:", describe(err));
    }
  };

  void run();
}

// In-process fallback used when NATS is unavailable: release tracking
// keeps working without a broker.
const localQueue: SentryEventMessage[] = [];
let draining = false;

export function enqueueReleaseEvent(event: SentryEventMessage): void {
  localQueue.push(event);
  void drainLocalQueue();
}

async function drainLocalQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (localQueue.length > 0) {
      const batch = localQueue.splice(0, CONCURRENCY);
      await Promise.allSettled(
        batch.map((event) =>
          processReleaseEvent(event).catch((err) => {
            console.error("[releases] Failed to record release:", describe(err));
          }),
        ),
      );
    }
  } finally {
    draining = false;
  }
  if (localQueue.length > 0) void drainLocalQueue();
}
