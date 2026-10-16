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
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notification),
    });
    if (!response.ok) {
      throw new Error(`webhook ${url} responded with status ${response.status}`);
    }
  },
};

// Slack: incoming webhook URL when configured, otherwise the
// chat.postMessage API (Bearer token + channel).
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

// Email: SMTP delivery via nodemailer is planned. Until then the
// notifier is a stub — it reports a delivery failure so callers can
// see the gap, but never breaks alert evaluation.
export const emailNotifier: Notifier = {
  type: "email",
  async send() {
    throw new Error(
      "email notifier is a stub: SMTP delivery not implemented yet",
    );
  },
};

const notifiers: Record<AlertChannelType, Notifier> = {
  email: emailNotifier,
  webhook: webhookNotifier,
  slack: slackNotifier,
  rocketchat: rocketChatNotifier,
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
}

// Shape shared by every rule kind (test sends and issue triggers).
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
  return {
    title: `Alert: ${rule.name}`,
    message: `${rule.metric} is ${value} (threshold ${rule.operator} ${rule.threshold}) over the last ${rule.windowSeconds}s for app ${appId ?? "global"}.`,
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

export function buildTestNotification(rule: AlertRuleLike): AlertNotification {
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
    appId: null,
    occurredAt: new Date().toISOString(),
  };
}

// Each channel is isolated: one failing
// channel never blocks or fails the others.
export async function deliverAlertToChannels(
  channels: AlertChannel[],
  notification: AlertNotification,
): Promise<DeliveryResult[]> {
  return Promise.all(
    channels.map(async (channel): Promise<DeliveryResult> => {
      const base = {
        channelId: channel.id,
        channelName: channel.name,
        type: channel.type,
      };
      const notifier = notifiers[channel.type];
      if (!notifier) {
        return {
          ...base,
          ok: false,
          error: `unknown channel type: ${channel.type}`,
        };
      }
      try {
        await notifier.send(notification, channel.config);
        return { ...base, ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[alerting] delivery failed via ${channel.type} channel "${channel.name}": ${message}`,
        );
        return { ...base, ok: false, error: message };
      }
    }),
  );
}
