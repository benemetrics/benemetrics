import { consumerOpts, createInbox, type JetStreamClient } from "nats";
import { issueDAO } from "db/dao/issues";
import { processIngestedEvent } from "./alerting/evaluation";
import { clearClickHouseEvents } from "./clickhouse";
import { SUBJECT, type SentryEventMessage } from "./nats";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Postgres side effects of an ingested event: issues/alerts (one-shot and
// race-safe, so redeliveries never duplicate them) and — for `clear` —
// truncating the ClickHouse events plus the derived issue state. The
// event payload itself is stored by ClickHouse from its own consumer;
// this path never touches it, so a ClickHouse outage cannot stall issue
// tracking (only `clear`, which has nothing to apply until it can
// truncate).
export async function applyEventMessage(event: SentryEventMessage): Promise<void> {
  if (event.type === "clear") {
    await clearClickHouseEvents();
    // Issues are derived from stored events; clearing the events clears
    // the derived issue state too. The UI live feed reads the stream
    // directly, so nothing is broadcast from here.
    await issueDAO.clear();
    return;
  }

  if (event.appId) {
    processIngestedEvent(
      event.appId,
      event.envelopeItems,
      event.receivedAt,
      event.id,
    );
  }
}

// Control messages (e.g. "clear") are applied after the events that
// preceded them. `deliverNew` matters when the durable is created for the
// first time: a fresh consumer must not replay the whole stream.
export function startEventsConsumer(
  jetstream: JetStreamClient,
  consumerName: string,
): void {
  const run = async () => {
    try {
      const opts = consumerOpts();
      opts.durable(consumerName);
      opts.deliverNew();
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
          console.error("[events] Failed to apply event side effects:", describe(err));
          msg.nak();
        }
      }
    } catch (err) {
      console.error("[events] Failed to start consumer:", describe(err));
    }
  };

  void run();
}

