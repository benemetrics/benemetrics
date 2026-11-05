import type {
  AlertChannel,
  AlertMetric,
  AlertNotification,
  AlertOperator,
  AlertSeverity,
  AlertTrigger,
  DeliveryResult,
} from "../protocol/alerting";
import type { IssueSummary } from "../protocol/issues";
import { notifiers } from "../alert-channels";
import { renderTemplate } from "./template";
import { countDelivery } from "./stats";

// Re-export every channel notifier so existing import sites keep working.
export {
  webhookNotifier,
  slackNotifier,
  rocketChatNotifier,
  emailNotifier,
  pagerDutyNotifier,
  opsgenieNotifier,
  msTeamsNotifier,
  victorOpsNotifier,
  notifierFor,
} from "../alert-channels";

export interface ThresholdRuleLike {
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  windowSeconds: number;
  /** The message template; null keeps the default message. */
  message?: string | null;
}

export interface AlertRuleLike {
  name: string;
  trigger: AlertTrigger;
  metric: AlertMetric | null;
  operator: AlertOperator | null;
  threshold: number | null;
  windowSeconds: number | null;
}

function severityForMetric(metric: AlertMetric): AlertSeverity {
  return metric === "fatal_count" ? "critical" : "warning";
}

export function buildAlertNotification(
  rule: ThresholdRuleLike,
  value: number,
  appId: string | null,
  occurredAt: string,
): AlertNotification {
  const defaultMessage = `${rule.metric} is ${value} (threshold ${rule.operator} ${rule.threshold}) over the last ${rule.windowSeconds}s for app ${appId ?? "global"}.`;
  const templated = renderTemplate(rule.message, {
    rule: { name: rule.name },
    metric: rule.metric,
    value,
    threshold: rule.threshold,
    operator: rule.operator,
    windowSeconds: rule.windowSeconds,
    appId,
  });
  return {
    title: `Alert: ${rule.name}`,
    message: templated || defaultMessage,
    severity: severityForMetric(rule.metric),
    ruleName: rule.name,
    trigger: "threshold",
    metric: rule.metric,
    value,
    threshold: rule.threshold,
    appId,
    occurredAt,
  };
}

export function buildIssueAlertNotification(
  rule: { name: string },
  trigger: "new_issue" | "regression",
  issue: IssueSummary,
  appId: string | null,
  occurredAt: string,
): AlertNotification {
  const scope = appId ? `app ${appId}` : "global";
  return {
    title: `Alert: ${rule.name}`,
    message:
      trigger === "new_issue"
        ? `New issue in ${scope}: ${issue.title}`
        : `Regression in ${scope}: ${issue.title}`,
    severity: "warning",
    ruleName: rule.name,
    trigger,
    metric: null,
    value: null,
    threshold: null,
    issue,
    appId,
    occurredAt,
  };
}

export function buildTestNotification(
  rule: AlertRuleLike,
  appId: string | null = null,
): AlertNotification {
  const isThreshold = rule.trigger === "threshold";
  return {
    title: `Test alert: ${rule.name}`,
    message: "This is a test notification for the alert rule.",
    severity: "info",
    ruleName: rule.name,
    trigger: rule.trigger,
    metric: isThreshold ? rule.metric : null,
    value: isThreshold ? (rule.threshold ?? 0) : null,
    threshold: isThreshold ? (rule.threshold ?? 0) : null,
    appId,
    occurredAt: new Date().toISOString(),
  };
}

// The notification a channel test sends: it carries the channel's own
// name, so the receiver can tell a test from a real alert.
export function buildChannelTestNotification(
  channelName: string,
  appId: string | null = null,
): AlertNotification {
  return {
    title: `Test alert: ${channelName}`,
    message: "This is a test notification for the alert channel.",
    severity: "info",
    ruleName: channelName,
    trigger: "threshold",
    metric: null,
    value: null,
    threshold: null,
    appId,
    occurredAt: new Date().toISOString(),
  };
}

// The delivery queue: the notification volume is bounded, so a spike
// cannot fan out without limit. The pending deliveries are capped and the
// workers are bounded; a delivery that cannot be queued is refused and the
// caller records it in the dead letter queue.
const MAX_PENDING_DELIVERIES =
  Number(process.env.ALERT_DELIVERY_QUEUE_SIZE) || 1000;
const DELIVERY_CONCURRENCY =
  Number(process.env.ALERT_DELIVERY_CONCURRENCY) || 8;

interface PendingDelivery {
  channel: AlertChannel;
  notification: AlertNotification;
  resolve: (result: DeliveryResult) => void;
}

const pendingDeliveries: PendingDelivery[] = [];
let activeDeliveries = 0;

// Sends one notification to one channel.
export function deliverNotificationToChannel(
  channel: AlertChannel,
  notification: AlertNotification,
): Promise<DeliveryResult> {
  const base = {
    channelId: channel.id,
    channelName: channel.name,
    type: channel.type,
  };
  const notifier = notifiers[channel.type];
  if (!notifier) {
    return Promise.resolve({
      ...base,
      ok: false,
      error: `no notifier for channel type: ${channel.type}`,
    });
  }
  return notifier.send(notification, channel.config).then(
    () => {
      countDelivery(true);
      return { ...base, ok: true };
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      countDelivery(false);
      console.error(
        `[alerting] delivery failed via ${channel.type} channel "${channel.name}": ${message}`,
      );
      return { ...base, ok: false, error: message };
    },
  );
}

function pumpDeliveries(): void {
  while (
    activeDeliveries < DELIVERY_CONCURRENCY &&
    pendingDeliveries.length > 0
  ) {
    const job = pendingDeliveries.shift()!;
    activeDeliveries += 1;
    void deliverNotificationToChannel(job.channel, job.notification)
      .then(
        (result) => job.resolve(result),
        () =>
          job.resolve({
            channelId: job.channel.id,
            channelName: job.channel.name,
            type: job.channel.type,
            ok: false,
            error: "the delivery failed",
          }),
      )
      .finally(() => {
        activeDeliveries -= 1;
        pumpDeliveries();
      });
  }
}

// Queues one delivery; the promise settles when it has been sent (or has
// failed).
export function enqueueDelivery(
  channel: AlertChannel,
  notification: AlertNotification,
): Promise<DeliveryResult> {
  if (pendingDeliveries.length >= MAX_PENDING_DELIVERIES) {
    return Promise.resolve({
      channelId: channel.id,
      channelName: channel.name,
      type: channel.type,
      ok: false,
      error: "the delivery queue is full",
    });
  }
  return new Promise<DeliveryResult>((resolve) => {
    pendingDeliveries.push({ channel, notification, resolve });
    pumpDeliveries();
  });
}

export async function deliverAlertToChannels(
  channels: AlertChannel[],
  notification: AlertNotification,
): Promise<DeliveryResult[]> {
  return Promise.all(
    channels.map((channel) => enqueueDelivery(channel, notification)),
  );
}
