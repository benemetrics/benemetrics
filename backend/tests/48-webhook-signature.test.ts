/**
 * Unit test: the webhook signature.
 *
 * The webhook notifier signs the body with the channel's shared secret
 * (Sentry's scheme: a timestamp and an HMAC-SHA256 over `<timestamp>.<body>`);
 * a receiver recomputes the digest and compares it in constant time.
 */
import { describe, expect, it } from "bun:test";
import {
  signWebhook,
  verifyWebhookSignature,
} from "../alerting/webhook-signature";

describe("webhook signature", () => {
  it("signs the body with the shared secret", () => {
    const { signature, timestamp } = signWebhook('{"a":1}', "s3cret", 1712345678);
    expect(signature).toStartWith("t=1712345678,v1=");
    expect(timestamp).toBe("1712345678");
  });

  it("verifies a signature it produced", () => {
    const body = JSON.stringify({ ruleName: "rule", value: 3 });
    const { signature, timestamp } = signWebhook(body, "s3cret", 1712345678);
    expect(
      verifyWebhookSignature(body, "s3cret", signature, timestamp, 300, 1712345678),
    ).toBe(true);
  });

  it("rejects a tampered body, another secret and a stale timestamp", () => {
    const body = JSON.stringify({ ruleName: "rule", value: 3 });
    const { signature, timestamp } = signWebhook(body, "s3cret", 1712345678);
    expect(
      verifyWebhookSignature(
        JSON.stringify({ ruleName: "rule", value: 4 }),
        "s3cret",
        signature,
        timestamp,
        300,
        1712345678,
      ),
    ).toBe(false);
    expect(
      verifyWebhookSignature(body, "other", signature, timestamp, 300, 1712345678),
    ).toBe(false);
    // A timestamp outside the replay window is rejected.
    expect(
      verifyWebhookSignature(body, "s3cret", signature, timestamp, 300, 1712349000),
    ).toBe(false);
    expect(
      verifyWebhookSignature(body, "s3cret", null, timestamp, 300, 1712345678),
    ).toBe(false);
  });

  it("rejects a signature without a v1 part", () => {
    const body = "{}";
    expect(
      verifyWebhookSignature(body, "s3cret", "t=1712345678", "1712345678", 300, 1712345678),
    ).toBe(false);
  });
});
