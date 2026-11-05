import type { Notifier } from "./notifier";
import {
  optionalRecord,
  optionalString,
  optionalStringList,
  requireString,
} from "./helpers";

export const opsgenieNotifier: Notifier = {
  type: "opsgenie",
  async send(notification, config) {
    const apiKey = requireString(config, "api_key", "opsgenie");
    const priority =
      optionalString(config, "priority") ??
      ((sev: "critical" | "warning" | "info"): string => {
        switch (sev) {
          case "critical":
            return "P1";
          case "warning":
            return "P2";
          default:
            return "P3";
        }
      })(notification.severity);
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
