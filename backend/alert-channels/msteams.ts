import type { Notifier } from "./notifier";
import { requireString } from "./helpers";

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
