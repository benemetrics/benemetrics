import type { Notifier } from "./notifier";
import { optionalRecord, optionalString, requireString } from "./helpers";

export const pagerDutyNotifier: Notifier = {
  type: "pagerduty",
  async send(notification, config) {
    const routingKey = requireString(config, "routing_key", "pagerduty");
    const severity =
      optionalString(config, "severity") ??
      ((sev: "critical" | "warning" | "info"): string => {
        switch (sev) {
          case "critical":
            return "critical";
          case "warning":
            return "error";
          default:
            return "warning";
        }
      })(notification.severity);
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
