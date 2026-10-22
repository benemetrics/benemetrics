/**
 * API Test: the alerting notifiers.
 *
 * Each notifier posts to a vendor API; the calls are captured so the
 * payload, the headers and the endpoint are asserted without a network.
 */

import { describe, it, expect, afterEach } from "bun:test";
import {
  msTeamsNotifier,
  opsgenieNotifier,
  pagerDutyNotifier,
  victorOpsNotifier,
} from "../alerting/notifiers";
import type { AlertNotification } from "../protocol/alerting";

const realFetch = globalThis.fetch;

const notification: AlertNotification = {
  title: "Error count above the threshold",
  message: "The error count breached the rule.",
  severity: "critical",
  ruleName: "Errors",
  trigger: "threshold",
  metric: "error_count",
  value: 12,
  threshold: 5,
  issue: undefined,
  appId: null,
  occurredAt: "2026-01-01T00:00:00.000Z",
};

interface Captured {
  url: string;
  init: RequestInit;
}

function captureFetch(): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response("{}", {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

function bodyOf(call: Captured): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Alerting notifiers", () => {
  it("sends a PagerDuty event", async () => {
    const calls = captureFetch();
    await pagerDutyNotifier.send(notification, { routing_key: "pd-key" });

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://events.pagerduty.com/v2/envelopes");
    const body = bodyOf(calls[0]!);
    expect(body.routingKey).toBe("pd-key");
    expect(body.eventAction).toBe("trigger");
    const payload = body.payload as Record<string, unknown>;
    expect(payload.summary).toBe(notification.title);
    expect(payload.severity).toBe("critical");
  });

  it("sends an Opsgenie alert", async () => {
    const calls = captureFetch();
    await opsgenieNotifier.send(notification, { api_key: "og-key" });

    expect(calls[0]!.url).toBe("https://api.opsgenie.com/v2/alerts");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("GenieKey og-key");
    const body = bodyOf(calls[0]!);
    expect(body.message).toBe(notification.title);
    expect(body.priority).toBe("P1");
  });

  it("sends a Microsoft Teams card", async () => {
    const calls = captureFetch();
    await msTeamsNotifier.send(notification, { webhookUrl: "https://teams.example/hook" });

    expect(calls[0]!.url).toBe("https://teams.example/hook");
    const body = bodyOf(calls[0]!);
    expect(body.type).toBe("message");
    const attachments = body.attachments as Array<Record<string, unknown>>;
    expect(attachments.length).toBe(1);
  });

  it("sends a VictorOps alert", async () => {
    const calls = captureFetch();
    await victorOpsNotifier.send(notification, {
      api_key: "vo-api",
      routing_key: "vo-route",
    });

    expect(calls[0]!.url).toBe(
      "https://alert.victorops.com/integrations/generic/20131114/alert/vo-api/vo-route",
    );
    const body = bodyOf(calls[0]!);
    expect(body.message).toBe(notification.title);
    expect(body.severity).toBe("critical");
  });

  it("rejects a notifier without its credentials", async () => {
    captureFetch();
    await expect(pagerDutyNotifier.send(notification, {})).rejects.toThrow(
      "pagerduty notifier requires config.routing_key",
    );
    await expect(opsgenieNotifier.send(notification, {})).rejects.toThrow(
      "opsgenie notifier requires config.api_key",
    );
    await expect(msTeamsNotifier.send(notification, {})).rejects.toThrow(
      "msteams notifier requires config.webhookUrl",
    );
    await expect(
      victorOpsNotifier.send(notification, { api_key: "a" }),
    ).rejects.toThrow("victorops notifier requires config.routing_key");
  });

  it("reports a vendor failure", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      pagerDutyNotifier.send(notification, { routing_key: "pd-key" }),
    ).rejects.toThrow("pagerduty events API responded with status 500");
  });
});
