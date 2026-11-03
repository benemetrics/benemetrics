import nodemailer from "nodemailer";
import type { AlertNotification } from "../protocol/alerting";
import type { Notifier } from "./notifier";
import { requireString } from "./helpers";

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
