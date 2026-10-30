import type { AlertChannelType, AlertNotification } from "./alerting";

/** The channel a delivery targets — resolved once, at publish time. */
export interface DeliveryChannel {
  id: string;
  name: string;
  type: AlertChannelType;
  config: Record<string, unknown>;
}

/**
 * One message of the `snotify.deliver` subject: the worker sends the
 * notification to the embedded channel; a terminal failure republishes the
 * entry to `snotify.dlq`.
 */
export interface NotificationDelivery {
  notification: AlertNotification;
  channel: DeliveryChannel;
  /** The ISO time the delivery was queued by the dispatcher. */
  queuedAt: string;
}

/** One dead letter: a read-only view of the DLQ stream message. */
export interface NotificationDeadLetter {
  /** The DLQ stream sequence — the dismiss handle. */
  seq: number;
  notification: AlertNotification;
  channel: DeliveryChannel;
  attempts: number;
  error: string;
  failedAt: string;
}

/** The result of a dismiss: `false` means the message was already gone. */
export interface DeadLetterDismissResult {
  dismissed: boolean;
}
