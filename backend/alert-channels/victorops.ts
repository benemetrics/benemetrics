import type { AlertNotification } from "../protocol/alerting";
import type { Notifier } from "./notifier";
import { optionalString, requireString } from "./helpers";

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
