import type {
  AlertChannelType,
  AlertNotification,
  AlertSeverity,
} from "../protocol/alerting";

export function requireString(
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

export function optionalString(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  return typeof value === "string" && value ? value : undefined;
}

export function optionalRecord(
  config: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = config[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

export function optionalStringList(
  config: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = config[key];
  if (!Array.isArray(value)) return undefined;
  const list = value.map((entry) => String(entry)).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export function severityEmoji(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return ":rotating_light:";
    case "warning":
      return ":warning:";
    default:
      return ":information_source:";
  }
}

export function severityColor(severity: AlertSeverity): string {
  switch (severity) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "good";
  }
}

export function formatChatText(notification: AlertNotification): string {
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
