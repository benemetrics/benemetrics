/**
 * The webhook signature: the Sentry-compatible scheme — a timestamp and an
 * HMAC-SHA256 over the timestamp and the body.
 *
 *   X-Sentry-Hook-Signature: t=1712345678,v1=<hex digest>
 *   X-Sentry-Hook-Timestamp: 1712345678
 *
 * The receiver recomputes the digest over `<timestamp>.<body>` with the shared
 * secret and compares it in constant time; the timestamp bounds the replay
 * window.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "X-Sentry-Hook-Signature";
export const TIMESTAMP_HEADER = "X-Sentry-Hook-Timestamp";

/** The signature of a webhook body: `t=<unix seconds>,v1=<hex digest>`. */
export function signWebhook(
  body: string,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): { signature: string; timestamp: string } {
  const timestamp = String(timestampSeconds);
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return { signature: `t=${timestamp},v1=${digest}`, timestamp };
}

/**
 * Verifies a signature — the receiving side of the webhook contract (and
 * what the docs tell an operator to implement).
 */
export function verifyWebhookSignature(
  body: string,
  secret: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!signature || !timestamp) return false;
  const parts = new Map(
    signature.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index), part.slice(index + 1)] as const;
    }),
  );
  const provided = parts.get("v1");
  if (!provided) return false;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(nowSeconds - sent) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
