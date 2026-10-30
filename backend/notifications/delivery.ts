import type { JsMsg } from "@nats-io/jetstream";
import {
  NOTIFY_MAX_DELIVER,
  NOTIFY_STREAM,
  NOTIFY_WORKER_CONSUMER,
  natsManager,
  publishDeadLetter,
} from "../nats";
import { notifierFor } from "../alerting/notifiers";
import type { NotificationDelivery } from "../protocol/notifications";

// The notification worker: JetStream is the only delivery channel, so a
// send failure is retried by broker redelivery and the attempt whose budget
// is spent is republished into the DLQ stream for the admin to act on.

async function deadLetter(
  message: JsMsg,
  entry: NotificationDelivery,
  error: string,
): Promise<void> {
  const attempts = message.info.deliveryCount;
  console.error(
    `[notifications] dead letter for channel "${entry.channel.name}" after ${attempts} attempts: ${error}`,
  );
  message.term();
  try {
    await publishDeadLetter({
      notification: entry.notification,
      channel: entry.channel,
      attempts,
      error,
      failedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "[notifications] failed to publish the dead letter:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function processMessage(message: JsMsg): Promise<void> {
  let entry: NotificationDelivery;
  try {
    entry = JSON.parse(message.string()) as NotificationDelivery;
  } catch {
    // An unparsable payload is unrecoverable; hold it for inspection.
    console.error(
      `[notifications] unparsable delivery on the stream (seq ${message.info.streamSequence})`,
    );
    message.term();
    return;
  }
  const notifier = notifierFor(entry.channel.type);
  if (!notifier) {
    await deadLetter(
      message,
      entry,
      `no notifier for channel type: ${entry.channel.type}`,
    );
    return;
  }
  try {
    await notifier.send(entry.notification, entry.channel.config);
    message.ack();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (message.info.deliveryCount >= NOTIFY_MAX_DELIVER) {
      // Last attempt: republish the entry, then terminate the source
      // message so the work queue cannot redeliver it again.
      await deadLetter(message, entry, error);
    } else {
      console.error(
        `[notifications] delivery failed via ${entry.channel.type} channel "${entry.channel.name}" (attempt ${message.info.deliveryCount}/${NOTIFY_MAX_DELIVER}): ${error}`,
      );
      message.nak();
    }
  }
}

async function runWorker(): Promise<void> {
  const consumer = await natsManager
    .jetstream()
    .consumers.get(NOTIFY_STREAM, NOTIFY_WORKER_CONSUMER);
  for await (const message of await consumer.consume()) {
    await processMessage(message);
  }
}

export function startNotificationWorker(): void {
  void runWorker().catch((err) => {
    console.error(
      "[notifications] worker stopped:",
      err instanceof Error ? err.message : err,
    );
  });
}
