/**
 * Standalone side-effects consumer binary: `bun backend/consumer.ts`.
 * Applies the Postgres side effects (issues, alerts, releases).
 */

import { processIngestedEvent } from "./alerting/evaluation";
import { parseIssueDigests } from "./issues/tracking";
import {
  jetstream2,
  nats,
  SIDE_EFFECTS_CONSUMER,
  STREAM_NAME,
} from "./nats";
import type { SentryEventMessage } from "./protocol/events";
import { recordReleaseFromEvent } from "./releases/tracking";

// Issues/alerts are one-shot and race-safe; release writes are idempotent,
// so retries never duplicate them.
async function applyEventMessage(event: SentryEventMessage): Promise<void> {
  if (!event.appId) return;
  const digests = parseIssueDigests(event.issueEvents, event.envelopeItems);
  processIngestedEvent(event.appId, digests, event.receivedAt, event.id, event.projectId);
  try {
    await recordReleaseFromEvent(event);
  } catch (err) {
    console.error(
      "[consumer] Failed to record release:",
      err instanceof Error ? err.message : err,
    );
  }
}

void (async () => {
  // A durable pull consumer: an event published while this process is down is not lost.
  const consumer = await jetstream2.consumers.get(
    STREAM_NAME,
    SIDE_EFFECTS_CONSUMER,
  );
  for await (const message of await consumer.consume()) {
    try {
      const payload = message.string();
      // Handle batched events (JSONEachRow format)
      const lines = payload.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        await applyEventMessage(JSON.parse(line) as SentryEventMessage);
      }
      message.ack();
    } catch (err) {
      console.error(
        "[consumer] Failed to apply event side effects:",
        err instanceof Error ? err.message : err,
      );
      // Not acknowledged: the message is redelivered.
    }
  }
})();

const shutdown = async () => {
  await nats.drain().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
