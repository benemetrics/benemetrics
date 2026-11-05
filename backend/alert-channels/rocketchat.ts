import type { Notifier } from "./notifier";
import { requireString } from "./helpers";
import { formatChatText, severityColor } from "./helpers";

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
