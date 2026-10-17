/**
 * E2E Test: Alerting rules (global config + per-app override + threshold evaluation)
 *
 * Exercises the admin alerting endpoints mounted at /api/admin/alerting:
 *   - Channel CRUD (webhook/slack/rocketchat/email) — global and per-app scoped
 *   - Rule CRUD (metric, operator, threshold, window, cooldown, channels)
 *   - Per-name override: an app-scoped row replaces the global row of the same name
 *   - Threshold evaluation triggered by ingestion (error_count, fatal_count,
 *     new_issue_count, latency_p95/p99) with cooldown and incident history
 *   - Uniform delivery: webhook/slack/rocketchat all POST to the configured URL,
 *     which the test observes through a local fake receiver
 * Starts a real server on an ephemeral port for testing.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

let baseUrl = "";
let server: any;

// Fake receiver for every outbound channel (webhook/slack/rocketchat all POST here).
let webhookServer: any;
let webhookUrl = "";
const webhookCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

const ADMIN_TOKEN = "Bearer e2e-admin-token";
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token: string = ADMIN_TOKEN,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: token },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface AlertApp {
  projectId: string;
  id: string;
  ingestKey: string;
  publicKey: string;
}

async function makeApp(): Promise<AlertApp> {
  const project = await json<{ id: string }>(
    await apiRequest("POST", "/api/admin/projects", { name: `AlertProj-${uniq()}` }),
  );
  const appRecord = await json<{ id: string; ingestKey: string; publicKey: string }>(
    await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
      name: `AlertApp-${uniq()}`,
    }),
  );
  return { projectId: project.id, ...appRecord };
}

// Legacy store ingestion: the path segment is the app ingest key and the
// DSN public key is sent as the sentry_key query param.
async function ingestEvent(app: AlertApp, event: Record<string, unknown>): Promise<Response> {
  return fetch(
    `${baseUrl}/api/${app.ingestKey}/store/?sentry_key=${encodeURIComponent(app.publicKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );
}

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  let last: T;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  last = await fn();
  return last;
}

function errorEvent(id: string, message: string, level = "error"): Record<string, unknown> {
  return { event_id: id, level, message, environment: "test" };
}

function transactionEvent(id: string, duration: number): Record<string, unknown> {
  return {
    event_id: id,
    transaction: "GET /api/test",
    measurements: { duration: { value: duration } },
  };
}

function waitForWebhook(predicate: (body: Record<string, unknown>) => boolean) {
  return waitFor(
    () => Promise.resolve(webhookCalls.map((call) => call.body)),
    (bodies) => bodies.some(predicate),
  );
}

describe("Alerting (channels, rules, threshold evaluation)", () => {
  beforeAll(async () => {
    app.listen(0);
    server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;

    webhookServer = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = await request.json().catch(() => ({}));
        webhookCalls.push({ url: request.url, body });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    webhookUrl = `http://localhost:${webhookServer.port}/hook`;
  });

  afterAll(() => {
    server.stop();
    webhookServer.stop();
  });

  describe("Channel CRUD (global scope)", () => {
    it("creates, lists, patches and deletes a webhook channel", async () => {
      const created = await json<{
        id: string;
        name: string;
        type: string;
        config: Record<string, unknown>;
        appId: string | null;
      }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `ops-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
        }),
      );

      expect(created.id).toBeDefined();
      expect(created.type).toBe("webhook");
      expect(created.config.url).toBe(webhookUrl);
      expect(created.appId).toBeNull();

      const list = await json<{ data: Array<{ id: string }> }>(
        await apiRequest("GET", "/api/admin/alerting/channels"),
      );
      expect(list.data.some((channel) => channel.id === created.id)).toBe(true);

      const patched = await json<{ config: Record<string, unknown> }>(
        await apiRequest("PATCH", `/api/admin/alerting/channels/${created.id}`, {
          config: { url: `${webhookUrl}?patched=1` },
        }),
      );
      expect(patched.config.url).toBe(`${webhookUrl}?patched=1`);

      const removed = await apiRequest("DELETE", `/api/admin/alerting/channels/${created.id}`);
      expect(removed.status).toBe(200);

      const gone = await apiRequest("GET", `/api/admin/alerting/channels/${created.id}`);
      expect(gone.status).toBe(404);
    });

    it("rejects duplicate channel names within the same scope (409)", async () => {
      const name = `dup-${uniq()}`;
      const first = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name,
          type: "webhook",
          config: { url: webhookUrl },
        }),
      );

      const second = await apiRequest("POST", "/api/admin/alerting/channels", {
        name,
        type: "webhook",
        config: { url: webhookUrl },
      });
      expect(second.status).toBe(409);

      // Keep the global scope clean for later tests.
      await apiRequest("DELETE", `/api/admin/alerting/channels/${first.id}`);
    });

    it("resolves concurrent creates of the same global channel name with one winner", async () => {
      const name = `race-${uniq()}`;

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          apiRequest("POST", "/api/admin/alerting/channels", {
            name,
            type: "webhook",
            config: { url: webhookUrl },
          }),
        ),
      );

      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(4);

      const list = await json<{ data: Array<{ id: string; name: string }> }>(
        await apiRequest("GET", "/api/admin/alerting/channels"),
      );
      const created = list.data.filter((channel) => channel.name === name);
      expect(created).toHaveLength(1);

      // Keep the global scope clean for later tests.
      await apiRequest("DELETE", `/api/admin/alerting/channels/${created[0]!.id}`);
    });

    it("rejects an unknown channel type (400)", async () => {
      const response = await apiRequest("POST", "/api/admin/alerting/channels", {
        name: `bad-${uniq()}`,
        type: "carrier-pigeon",
        config: {},
      });
      expect(response.status).toBe(400);
    });
  });

  describe("Per-app override (per-name resolution)", () => {
    it("app-scoped channel replaces the global channel of the same name", async () => {
      const appRecord = await makeApp();
      const tag = uniq();

      await apiRequest("POST", "/api/admin/alerting/channels", {
        name: `shared-${tag}`,
        type: "webhook",
        config: { url: webhookUrl, scope: "global" },
      });
      await apiRequest("POST", "/api/admin/alerting/channels", {
        name: `global-only-${tag}`,
        type: "webhook",
        config: { url: webhookUrl, scope: "global-only" },
      });
      await apiRequest("POST", "/api/admin/alerting/channels", {
        name: `shared-${tag}`,
        type: "webhook",
        config: { url: webhookUrl, scope: "app" },
        appId: appRecord.id,
      });

      const effective = await json<{
        channels: Array<{ name: string; config: Record<string, unknown> }>;
      }>(await apiRequest("GET", `/api/admin/alerting/apps/${appRecord.id}/effective`));

      const shared = effective.channels.find((channel) => channel.name === `shared-${tag}`);
      expect(shared).toBeDefined();
      expect(shared!.config.scope).toBe("app");

      const globalOnly = effective.channels.find(
        (channel) => channel.name === `global-only-${tag}`,
      );
      expect(globalOnly).toBeDefined();
      expect(globalOnly!.config.scope).toBe("global-only");

      expect(effective.channels.length).toBe(2);
    });

    it("app-scoped rule replaces the global rule of the same name", async () => {
      const appRecord = await makeApp();
      const tag = uniq();

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `errors-${tag}`,
        metric: "error_count",
        operator: "gt",
        threshold: 1000,
        windowSeconds: 3600,
      });
      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `errors-${tag}`,
        metric: "error_count",
        operator: "gt",
        threshold: 1,
        windowSeconds: 3600,
        appId: appRecord.id,
      });

      const effective = await json<{
        rules: Array<{ name: string; threshold: number }>;
      }>(await apiRequest("GET", `/api/admin/alerting/apps/${appRecord.id}/effective`));

      const rule = effective.rules.find((r) => r.name === `errors-${tag}`);
      expect(rule).toBeDefined();
      expect(rule!.threshold).toBe(1);
      expect(effective.rules.length).toBe(1);
    });
  });

  describe("Rule CRUD", () => {
    it("creates, lists, patches and deletes a rule", async () => {
      const created = await json<{
        id: string;
        name: string;
        metric: string;
        operator: string;
        threshold: number;
        windowSeconds: number;
        cooldownSeconds: number;
        channelIds: string[];
        isEnabled: boolean;
      }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name: `rule-${uniq()}`,
          metric: "error_count",
          operator: "gt",
          threshold: 2,
          windowSeconds: 3600,
          cooldownSeconds: 60,
        }),
      );

      expect(created.metric).toBe("error_count");
      expect(created.operator).toBe("gt");
      expect(created.threshold).toBe(2);
      expect(created.windowSeconds).toBe(3600);
      expect(created.cooldownSeconds).toBe(60);
      expect(created.channelIds).toEqual([]);
      expect(created.isEnabled).toBe(true);

      const list = await json<{ data: unknown[]; pagination: { total: number } }>(
        await apiRequest("GET", "/api/admin/alerting/rules"),
      );
      expect(list.data.length).toBeGreaterThan(0);
      expect(list.pagination.total).toBeGreaterThan(0);

      const patched = await json<{ threshold: number; isEnabled: boolean }>(
        await apiRequest("PATCH", `/api/admin/alerting/rules/${created.id}`, {
          threshold: 5,
          isEnabled: false,
        }),
      );
      expect(patched.threshold).toBe(5);
      expect(patched.isEnabled).toBe(false);

      const removed = await apiRequest("DELETE", `/api/admin/alerting/rules/${created.id}`);
      expect(removed.status).toBe(200);

      const gone = await apiRequest("GET", `/api/admin/alerting/rules/${created.id}`);
      expect(gone.status).toBe(404);
    });

    it("rejects duplicate rule names within the same scope (409)", async () => {
      const name = `dup-rule-${uniq()}`;
      const first = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name,
          metric: "event_count",
          operator: "gt",
          threshold: 1,
          windowSeconds: 300,
        }),
      );

      const second = await apiRequest("POST", "/api/admin/alerting/rules", {
        name,
        metric: "event_count",
        operator: "gt",
        threshold: 1,
        windowSeconds: 300,
      });
      expect(second.status).toBe(409);

      // Keep the global scope clean for later tests.
      await apiRequest("DELETE", `/api/admin/alerting/rules/${first.id}`);
    });
  });

  describe("Threshold evaluation on ingestion", () => {
    it("fires an incident and delivers to a webhook when error_count breaches", async () => {
      const appRecord = await makeApp();
      const ruleName = `error storm ${uniq()}`;

      const channel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `web-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: ruleName,
        metric: "error_count",
        operator: "gt",
        threshold: 2,
        windowSeconds: 3600,
        cooldownSeconds: 60,
        channelIds: [channel.id],
        appId: appRecord.id,
      });

      for (let i = 0; i < 3; i++) {
        const response = await ingestEvent(
          appRecord,
          errorEvent(crypto.randomUUID(), `boom ${i}`),
        );
        expect(response.status).toBe(200);
      }

      // Evaluation is asynchronous (fire-and-forget after ingestion).
      const incidents = await waitFor(
        async () =>
          json<{ data: Array<Record<string, unknown>> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.length > 0,
      );

      expect(incidents.data.length).toBe(1);
      const incident = incidents.data[0]!;
      expect(incident.metric).toBe("error_count");
      expect(incident.value).toBe(3);
      expect(incident.threshold).toBe(2);
      expect(incident.status).toBe("firing");
      expect(incident.appId).toBe(appRecord.id);

      const bodies = await waitForWebhook(
        (body) => body.ruleName === ruleName && body.metric === "error_count",
      );
      const notification = bodies.find((body) => body.ruleName === ruleName)!;
      expect(notification.value).toBe(3);
      expect(notification.threshold).toBe(2);
      expect(notification.severity).toBe("warning");
      expect(notification.appId).toBe(appRecord.id);
    });

    it("respects the cooldown: no second incident within the cooldown window", async () => {
      const appRecord = await makeApp();

      const channel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `cool-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `cooled ${uniq()}`,
        metric: "error_count",
        operator: "gt",
        threshold: 1,
        windowSeconds: 3600,
        cooldownSeconds: 60,
        channelIds: [channel.id],
        appId: appRecord.id,
      });

      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "first"));
      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "second"));

      await waitFor(
        async () =>
          json<{ data: unknown[] }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.length === 1,
      );

      // More errors arrive, but the cooldown (60s) suppresses re-notification.
      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "third"));
      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "fourth"));

      await new Promise((resolve) => setTimeout(resolve, 500));

      const incidents = await json<{ data: unknown[] }>(
        await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
      );
      expect(incidents.data.length).toBe(1);
    });

    it("counts fatal events separately from errors (fatal_count)", async () => {
      const appRecord = await makeApp();

      const channel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `fatal-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `fatal spike ${uniq()}`,
        metric: "fatal_count",
        operator: "gt",
        threshold: 0,
        windowSeconds: 3600,
        cooldownSeconds: 60,
        channelIds: [channel.id],
        appId: appRecord.id,
      });

      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "just an error", "error"));
      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "fatal!", "fatal"));

      const incidents = await waitFor(
        async () =>
          json<{ data: Array<Record<string, unknown>> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.length > 0,
      );

      expect(incidents.data[0]!.metric).toBe("fatal_count");
      expect(incidents.data[0]!.value).toBe(1);
    });

    it("counts distinct new issues (new_issue_count)", async () => {
      const appRecord = await makeApp();

      const channel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `issues-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `new issues ${uniq()}`,
        metric: "new_issue_count",
        operator: "gt",
        threshold: 1,
        windowSeconds: 3600,
        cooldownSeconds: 60,
        channelIds: [channel.id],
        appId: appRecord.id,
      });

      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "distinct problem A"));
      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "distinct problem B"));

      const incidents = await waitFor(
        async () =>
          json<{ data: Array<Record<string, unknown>> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.length > 0,
      );

      expect(incidents.data[0]!.metric).toBe("new_issue_count");
      expect(incidents.data[0]!.value).toBe(2);
    });

    it("evaluates latency percentiles from transaction measurements (latency_p95)", async () => {
      const appRecord = await makeApp();

      const channel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `lat-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `slow p95 ${uniq()}`,
        metric: "latency_p95",
        operator: "gt",
        threshold: 400,
        windowSeconds: 3600,
        cooldownSeconds: 60,
        channelIds: [channel.id],
        appId: appRecord.id,
      });

      // p95 of [100, 200, 300, 400, 500] (nearest-rank) is 500.
      for (const duration of [100, 200, 300, 400, 500]) {
        await ingestEvent(appRecord, transactionEvent(crypto.randomUUID(), duration));
      }

      const incidents = await waitFor(
        async () =>
          json<{ data: Array<Record<string, unknown>> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.length > 0,
      );

      expect(incidents.data[0]!.metric).toBe("latency_p95");
      expect(incidents.data[0]!.value).toBe(500);
      expect(incidents.data[0]!.threshold).toBe(400);
    });

    it("delivers through slack and rocketchat channels via their webhook URLs", async () => {
      const appRecord = await makeApp();
      const ruleName = `multi channel ${uniq()}`;

      const slackChannel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `slack-${uniq()}`,
          type: "slack",
          config: { webhookUrl: webhookUrl },
          appId: appRecord.id,
        }),
      );
      const rocketChannel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `rocket-${uniq()}`,
          type: "rocketchat",
          config: { webhookUrl: webhookUrl },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: ruleName,
        metric: "error_count",
        operator: "gt",
        threshold: 0,
        windowSeconds: 3600,
        cooldownSeconds: 60,
        channelIds: [slackChannel.id, rocketChannel.id],
        appId: appRecord.id,
      });

      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "multi-channel failure"));

      const bodies = await waitForWebhook((body) => typeof body.text === "string");
      const texts = bodies.map((body) => String(body.text ?? ""));
      expect(texts.some((text) => text.includes(ruleName))).toBe(true);
      expect(texts.length).toBeGreaterThanOrEqual(2);
    });

    it("records a firing incident even when delivery fails (email stub)", async () => {
      const appRecord = await makeApp();

      const emailChannel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `mail-${uniq()}`,
          type: "email",
          config: { to: "ops@example.com", from: "sentry@example.com" },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `mail only ${uniq()}`,
        metric: "error_count",
        operator: "gt",
        threshold: 0,
        windowSeconds: 3600,
        cooldownSeconds: 60,
        channelIds: [emailChannel.id],
        appId: appRecord.id,
      });

      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "email stub test"));

      const incidents = await waitFor(
        async () =>
          json<{ data: Array<Record<string, unknown>> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.length > 0,
      );

      expect(incidents.data[0]!.metric).toBe("error_count");
    });
  });

  describe("Test send", () => {
    it("sends a test notification through the rule's channels", async () => {
      const appRecord = await makeApp();

      const channel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `test-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: appRecord.id,
        }),
      );

      const rule = await json<{ id: string; name: string }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name: `test send ${uniq()}`,
          metric: "error_count",
          operator: "gt",
          threshold: 2,
          windowSeconds: 3600,
          cooldownSeconds: 60,
          channelIds: [channel.id],
          appId: appRecord.id,
        }),
      );

      const result = await json<{
        results: Array<{ channelId: string; ok: boolean; type: string }>;
      }>(await apiRequest("POST", `/api/admin/alerting/rules/${rule.id}/test`));

      expect(result.results.length).toBe(1);
      expect(result.results[0]!.ok).toBe(true);
      expect(result.results[0]!.type).toBe("webhook");

      const bodies = await waitForWebhook(
        (body) => body.ruleName === rule.name && body.severity === "info",
      );
      expect(bodies.some((body) => body.ruleName === rule.name)).toBe(true);
    });

    it("reports per-channel failures without throwing (email stub)", async () => {
      const appRecord = await makeApp();

      const emailChannel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `mailtest-${uniq()}`,
          type: "email",
          config: { to: "ops@example.com" },
          appId: appRecord.id,
        }),
      );

      const rule = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name: `test stub ${uniq()}`,
          metric: "error_count",
          operator: "gt",
          threshold: 2,
          windowSeconds: 3600,
          channelIds: [emailChannel.id],
          appId: appRecord.id,
        }),
      );

      const result = await json<{
        results: Array<{ ok: boolean; error?: string }>;
      }>(await apiRequest("POST", `/api/admin/alerting/rules/${rule.id}/test`));

      expect(result.results[0]!.ok).toBe(false);
      expect(result.results[0]!.error).toContain("stub");
    });
  });

  describe("Incidents", () => {
    it("lists incidents and resolves them when the metric recovers", async () => {
      const appRecord = await makeApp();

      const channel = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/channels", {
          name: `res-${uniq()}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: appRecord.id,
        }),
      );

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `recover ${uniq()}`,
        metric: "error_count",
        operator: "gt",
        threshold: 0,
        windowSeconds: 1,
        cooldownSeconds: 0,
        channelIds: [channel.id],
        appId: appRecord.id,
      });

      await ingestEvent(appRecord, errorEvent(crypto.randomUUID(), "trigger"));

      await waitFor(
        async () =>
          json<{ data: Array<{ status: string }> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.some((incident) => incident.status === "firing"),
      );

      // The 1-second window expires and no new errors arrive: the incident resolves.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await ingestEvent(appRecord, {
        event_id: crypto.randomUUID(),
        level: "info",
        message: "keep-alive, not an error",
      });

      const incidents = await waitFor(
        async () =>
          json<{ data: Array<{ status: string; resolvedAt: string | null }> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appRecord.id}`),
          ),
        (body) => body.data.every((incident) => incident.status === "resolved"),
        8000,
      );

      expect(incidents.data.length).toBe(1);
      expect(incidents.data[0]!.status).toBe("resolved");
      expect(incidents.data[0]!.resolvedAt).not.toBeNull();
    });
  });
});
