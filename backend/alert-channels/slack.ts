import type { Notifier } from "./notifier";
import { requireString } from "./helpers";
import { formatChatText } from "./helpers";

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
