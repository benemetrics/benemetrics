import nodemailer from "nodemailer";
import type {
  AlertChannel,
  AlertChannelType,
  AlertMetric,
  AlertNotification,
  AlertOperator,
  AlertSeverity,
  AlertTrigger,
  DeliveryResult,
} from "../protocol/alerting";
import type { IssueSummary } from "../protocol/issues";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signWebhook,
} from "./webhook-signature";
import { countDelivery } from "./stats";
import { renderTemplate } from "./template";

export interface Notifier {
  readonly type: AlertChannelType;
  send(
    notification: AlertNotification,
    config: Record<string, unknown>,
  ): Promise<void>;
}

function requireString(
  config: Record<string, unknown>,
  key: string,
  type: AlertChannelType,
): string {
  const value = config[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`${type} notifier requires config.${key}`);
  }
  return value;
}

function optionalString(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  return typeof value === "string" && value ? value : undefined;
}

function optionalRecord(
  config: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = config[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function optionalStringList(
  config: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = config[key];
  if (!Array.isArray(value)) return undefined;
  const list = value.map((entry) => String(entry)).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function severityEmoji(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return ":rotating_light:";
    case "warning":
      return ":warning:";
    default:
      return ":information_source:";
  }
}

function severityColor(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "good";
  }
}

export const webhookNotifier: Notifier = {
  type: "webhook",
  async send(notification, config) {
    const url = requireString(config, "url", "webhook");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const configured = config.headers;
    if (
      configured &&
      typeof configured === "object" &&
      !Array.isArray(configured)
    ) {
      for (const [name, value] of Object.entries(configured)) {
        if (typeof value === "string") headers[name] = value;
      }
    }
    const body = JSON.stringify(notification);
    // A shared secret signs the body; the receiver verifies the signature.
    const secret = config.secret;
    if (typeof secret === "string" && secret.length > 0) {
      const { signature, timestamp } = signWebhook(body, secret);
      headers[SIGNATURE_HEADER] = signature;
      headers[TIMESTAMP_HEADER] = timestamp;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(
        `webhook ${url} responded with status ${response.status}`,
      );
    }
  },
};

export const slackNotifier: Notifier = {
  type: "slack",
  async send(notification, config) {
    const text = formatChatText(notification);
    const webhookUrl = config.webhookUrl;
    if (typeof webhookUrl === "string" && webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        throw new Error(
          `slack webhook responded with status ${response.status}`,
        );
      }
      return;
    }

    const token = requireString(config, "token", "slack");
    const channel = requireString(config, "channel", "slack");
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean };
    if (!response.ok || body.ok === false) {
      throw new Error(`slack chat.postMessage failed: ${JSON.stringify(body)}`);
    }
  },
};

export const rocketChatNotifier: Notifier = {
  type: "rocketchat",
  async send(notification, config) {
    const webhookUrl = requireString(config, "webhookUrl", "rocketchat");
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: formatChatText(notification),
        attachments: [
          {
            color: severityColor(notification.severity),
            title: notification.title,
            text: notification.message,
            fields:
              notification.trigger === "threshold"
                ? [
                    {
                      title: "Metric",
                      value: `${notification.metric} = ${notification.value}`,
                      short: true,
                    },
                    {
                      title: "Threshold",
                      value: String(notification.threshold),
                      short: true,
                    },
                  ]
                : [
                    {
                      title: "Issue",
                      value: notification.issue?.fingerprint ?? "—",
                      short: true,
                    },
                    {
                      title: "Trigger",
                      value: notification.trigger,
                      short: true,
                    },
                  ],
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(
        `rocket.chat webhook responded with status ${response.status}`,
      );
    }
  },
};

export const emailNotifier: Notifier = {
  type: "email",
  async send(notification, config) {
    const host = requireString(config, "host", "email");
    const from = requireString(config, "from", "email");
    const to = requireString(config, "to", "email");
    const auth = config.auth;
    const user =
      auth && typeof auth === "object" && !Array.isArray(auth)
        ? (auth as Record<string, unknown>).user
        : undefined;
    const pass =
      auth && typeof auth === "object" && !Array.isArray(auth)
        ? (auth as Record<string, unknown>).pass
        : undefined;

    const transport = nodemailer.createTransport({
      host,
      port: typeof config.port === "number" ? config.port : 587,
      secure: config.secure === true,
      ...(typeof user === "string" && typeof pass === "string"
        ? { auth: { user, pass } }
        : {}),
    });

    await transport.sendMail({
      from,
      to: to
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean),
      subject: notification.title,
      text: [
        notification.message,
        `severity: ${notification.severity}`,
        `rule: ${notification.ruleName}`,
        notification.trigger === "threshold"
          ? `metric: ${notification.metric} = ${notification.value} (threshold ${notification.threshold})`
          : `issue: ${notification.issue?.fingerprint ?? "unknown"}`,
        `occurred at: ${notification.occurredAt}`,
      ].join("\n"),
    });
  },
};

function pagerDutySeverity(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return "critical";
    case "warning":
      return "error";
    default:
      return "warning";
  }
}

function opsgeniePriority(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return "P1";
    case "warning":
      return "P2";
    default:
      return "P3";
  }
}

export const pagerDutyNotifier: Notifier = {
  type: "pagerduty",
  async send(notification, config) {
    const routingKey = requireString(config, "routing_key", "pagerduty");
    const severity =
      optionalString(config, "severity") ??
      pagerDutySeverity(notification.severity);
    const customDetails = optionalRecord(config, "custom_details");
    const response = await fetch("https://events.pagerduty.com/v2/envelopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routingKey,
        eventAction: "trigger",
        payload: {
          summary: notification.title,
          source: notification.ruleName,
          severity,
          customDetails: {
            message: notification.message,
            trigger: notification.trigger,
            metric: notification.metric,
            value: notification.value,
            threshold: notification.threshold,
            issue: notification.issue?.fingerprint ?? null,
            occurredAt: notification.occurredAt,
            ...customDetails,
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(
        `pagerduty events API responded with status ${response.status}`,
      );
    }
  },
};

export const opsgenieNotifier: Notifier = {
  type: "opsgenie",
  async send(notification, config) {
    const apiKey = requireString(config, "api_key", "opsgenie");
    const priority =
      optionalString(config, "priority") ??
      opsgeniePriority(notification.severity);
    const responders = optionalRecord(config, "responders");
    const tags = optionalStringList(config, "tags");
    const response = await fetch("https://api.opsgenie.com/v2/alerts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `GenieKey ${apiKey}`,
      },
      body: JSON.stringify({
        message: notification.title,
        description: notification.message,
        source: notification.ruleName,
        priority,
        ...(responders ? { responders } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
        details: {
          trigger: notification.trigger,
          metric: notification.metric,
          value: notification.value,
          threshold: notification.threshold,
          issue: notification.issue?.fingerprint ?? null,
          occurredAt: notification.occurredAt,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(
        `opsgenie alerts API responded with status ${response.status}`,
      );
    }
  },
};

export const msTeamsNotifier: Notifier = {
  type: "msteams",
  async send(notification, config) {
    const webhookUrl = requireString(config, "webhookUrl", "msteams");
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              type: "AdaptiveCard",
              body: [
                {
                  type: "TextBlock",
                  size: "Medium",
                  weight: "Bolder",
                  text: notification.title,
                },
                { type: "TextBlock", wrap: true, text: notification.message },
              ],
            },
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(
        `microsoft teams webhook responded with status ${response.status}`,
      );
    }
  },
};

export const victorOpsNotifier: Notifier = {
  type: "victorops",
  async send(notification, config) {
    const apiKey = requireString(config, "api_key", "victorops");
    const routingKey = requireString(config, "routing_key", "victorops");
    const messageType = optionalString(config, "message_type");
    const entityDisplayName = optionalString(config, "entity_display_name");
    const response = await fetch(
      `https://alert.victorops.com/integrations/generic/20131114/alert/${apiKey}/${routingKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: notification.title,
          entity_display_name: entityDisplayName ?? notification.ruleName,
          entity_id: notification.issue?.fingerprint ?? notification.ruleName,
          ...(messageType ? { message_type: messageType } : {}),
          state_message: notification.message,
          monitoring_tool: "Benemetrics",
          severity: notification.severity,
          timestamp: notification.occurredAt,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `victorops alert API responded with status ${response.status}`,
      );
    }
  },
};

const notifiers: Partial<Record<AlertChannelType, Notifier>> = {
  webhook: webhookNotifier,
  slack: slackNotifier,
  rocketchat: rocketChatNotifier,
  email: emailNotifier,
  pagerduty: pagerDutyNotifier,
  opsgenie: opsgenieNotifier,
  msteams: msTeamsNotifier,
  victorops: victorOpsNotifier,
};

function formatChatText(notification: AlertNotification): string {
  const lines = [
    `${severityEmoji(notification.severity)} *${notification.title}*`,
    notification.message,
  ];
  if (notification.trigger === "threshold") {
    lines.push(
      `metric: ${notification.metric} = ${notification.value} (threshold ${notification.threshold})`,
    );
  } else if (notification.issue) {
    lines.push(`issue: ${notification.issue.fingerprint}`);
  }
  return lines.join("\n");
}

function severityForMetric(metric: AlertMetric): AlertSeverity {
  return metric === "fatal_count" ? "critical" : "warning";
}

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
