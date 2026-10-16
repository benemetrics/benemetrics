import { consumerOpts, createInbox, type JetStreamClient } from "nats";
import { storedEventDAO } from "db/dao/stored-event";
import { issueDAO } from "db/dao/issues";
import { processIngestedEvent } from "./alerting/evaluation";
import { clearClickHouseEvents, pushClickHouseEvent } from "./clickhouse";
import { broadcastLive, buildLiveEvent } from "./live-events";
import { SUBJECT, type SentryEventMessage } from "./nats";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Returns false when the event id already existed, so retries never
// repeat side effects.
export async function applyEventMessage(
  event: SentryEventMessage,
): Promise<boolean> {
  if (event.type === "clear") {
    await storedEventDAO.clear();
    // Issues are derived from stored events; clearing the events clears
    // the derived issue state too.
    await issueDAO.clear();
    // ClickHouse holds a best-effort copy of events; clear it too so the
    // events API does not keep serving previous rows.
    await clearClickHouseEvents();
    broadcastLive({ type: "clear" });
    return true;
  }

  const [stored] = await storedEventDAO.create({
    id: event.id,
    projectId: event.projectId,
    appId: event.appId,
    envelopeHeader: event.envelopeHeader,
    envelopeItems: event.envelopeItems,
    raw: event.raw,
    receivedAt: event.receivedAt,
  });
  if (!stored) return false;

  // Analytics are best-effort: a ClickHouse outage must not affect the
  // Postgres write, the live push or the response.
  pushClickHouseEvent(event);
  broadcastLive(buildLiveEvent(event));
  if (event.appId) {
    processIngestedEvent(
      event.appId,
      event.envelopeItems,
      event.receivedAt,
      event.id,
    );
  }
  return true;
}

// Control messages (e.g. "clear") are applied after the events that
// preceded them.
export function startEventsConsumer(jetstream: JetStreamClient): void {
  const run = async () => {
    try {
      const opts = consumerOpts();
      opts.durable("sentry-events-consumer");
      opts.deliverTo(createInbox());
      opts.manualAck();
      opts.ackExplicit();

      const sub = await jetstream.subscribe(SUBJECT, opts);

      for await (const msg of sub) {
        let event: SentryEventMessage;
        try {
          event = JSON.parse(msg.string()) as SentryEventMessage;
        } catch (err) {
          console.error("[events] Discarding malformed message:", describe(err));
          msg.ack();
          continue;
        }

        try {
          await applyEventMessage(event);
          msg.ack();
        } catch (err) {
          console.error("[events] Failed to persist event:", describe(err));
          msg.nak();
        }
      }
    } catch (err) {
      console.error("[events] Failed to start consumer:", describe(err));
    }
  };

  void run();
}

// Live consumer: ephemeral (not durable) — every backend instance
// receives every new event. No replay, no persistence.
export function startLiveConsumer(jetstream: JetStreamClient): void {
  const run = async () => {
    try {
      const opts = consumerOpts();
      opts.deliverNew();
      opts.deliverTo(createInbox());
      opts.manualAck();
      opts.ackExplicit();

      const sub = await jetstream.subscribe(SUBJECT, opts);

      for await (const msg of sub) {
        try {
          const event = JSON.parse(msg.string()) as SentryEventMessage;
          broadcastLive(
            event.type === "clear" ? { type: "clear" } : buildLiveEvent(event),
          );
        } catch (err) {
          console.error("[live] Discarding malformed message:", describe(err));
        }
        msg.ack();
      }
    } catch (err) {
      console.error("[live] Failed to start consumer:", describe(err));
    }
  };

  void run();
}
