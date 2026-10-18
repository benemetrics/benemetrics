export interface AlertNotification {
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  ruleName: string;
  trigger: "threshold" | "new_issue" | "regression";
  metric: string | null;
  value: number | null;
  threshold: number | null;
  issue?: {
    id: string;
    title: string;
    fingerprint: string;
    level: string;
    appId: string;
    projectId: string;
    environmentId: string;
  };
  projectId: string;
  environmentId: string | null;
  occurredAt: string;
  link?: string;
}

export interface Notifier {
  type: string;
  send(notification: AlertNotification, config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
}

export const webhookNotifier: Notifier = {
  type: "webhook",
  async send(notification, config) {
    try {
      await fetch(String(config.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(config.headers as Record<string, string> || {}) },
        body: JSON.stringify(notification),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};

export const slackNotifier: Notifier = {
  type: "slack",
  async send(notification, config) {
    try {
      const url = String(config.webhookUrl || (config.token && config.channel
        ? "https://slack.com/api/chat.postMessage"
        : ""));
      if (!url) return { ok: false, error: "Missing Slack config" };

      if (config.webhookUrl) {
        await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: notification.title }) });
      } else {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(config.token)}` },
          body: JSON.stringify({ channel: config.channel, text: notification.title }),
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};

export const rocketchatNotifier: Notifier = {
  type: "rocketchat",
  async send(notification, config) {
    try {
      await fetch(String(config.webhookUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: notification.title }) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};

export const emailNotifier: Notifier = {
  type: "email",
  async send(notification, config) {
    console.log("[email] Would send:", notification.title);
    return { ok: false, error: "SMTP delivery not implemented yet" };
  },
};

export const notifiers: Record<string, Notifier> = {
  webhook: webhookNotifier,
  slack: slackNotifier,
  rocketchat: rocketchatNotifier,
  email: emailNotifier,
};

export async function deliverAlertToChannels(notification: AlertNotification, channelConfigs: Array<{ id: string; name: string; type: string; config: Record<string, unknown> }>) {
  const results = await Promise.all(
    channelConfigs.map(async (ch) => {
      const notifier = notifiers[ch.type];
      if (!notifier) return { channelId: ch.id, channelName: ch.name, type: ch.type, ok: false, error: "Unknown notifier type" };
      try {
        const result = await notifier.send(notification, ch.config);
        return { channelId: ch.id, channelName: ch.name, type: ch.type, ok: result.ok, error: result.error };
      } catch (err) {
        return { channelId: ch.id, channelName: ch.name, type: ch.type, ok: false, error: String(err) };
      }
    })
  );
  return results;
}