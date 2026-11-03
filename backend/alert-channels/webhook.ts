import type { AlertNotification } from "../protocol/alerting";
import type { Notifier } from "./notifier";
import { requireString } from "./helpers";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signWebhook } from "../alerting/webhook-signature";

export const webhookNotifier: Notifier = {
  type: "webhook",
  async send(notification, config) {
    const url = requireString(config, "url", "webhook");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const configured = config.headers;
    if (
      configured &&
      typeof configured === "object" &&
      !Array.isArray(configured)
    ) {
      for (const [name, value] of Object.entries(configured)) {
        if (typeof value === "string") headers[name] = value;
      }
    }
    const body = JSON.stringify(notification);
    // A shared secret signs the body; the receiver verifies the signature.
    const secret = config.secret;
    if (typeof secret === "string" && secret.length > 0) {
      const { signature, timestamp } = signWebhook(body, secret);
      headers[SIGNATURE_HEADER] = signature;
      headers[TIMESTAMP_HEADER] = timestamp;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(
        `webhook ${url} responded with status ${response.status}`,
      );
    }
  },
};
