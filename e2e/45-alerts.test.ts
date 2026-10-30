/**
 * E2E Test: Alerts
 *
 * POST/GET/PATCH/DELETE /api/admin/alerting/rules (+ incidents)
 * Runs against a real HTTP listener via startTestServer().
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startTestServer, ADMIN_TOKEN, type TestServer } from "./test-helpers";

let SERVER_URL = "";
let testServer!: TestServer;

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return await fetch(url, options);
}

beforeAll(async () => {
  testServer = await startTestServer();
  SERVER_URL = testServer.baseUrl;
});

afterAll(() => {
  testServer?.stop();
});

describe("Alerts", () => {
  it("creates, lists, patches and deletes a threshold alert rule", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `Alerts Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const app = await apiRequest(
      "POST",
      `/api/admin/projects/${projectData.id}/apps`,
      { name: `Alerts App ${Date.now()}` },
    );
    expect(app.status).toBe(200);
    const appData = (await app.json()) as { id: string };

    const channel = await apiRequest("POST", "/api/admin/alerting/channels", {
      name: `alert-channel-${Date.now()}`,
      type: "webhook",
      config: { url: "http://localhost:9999/hook" },
      projectId: projectData.id,
    });
    expect(channel.status).toBe(200);
    const channelData = (await channel.json()) as { id: string };

    const rule = await apiRequest("POST", "/api/admin/alerting/rules", {
      name: `high-error-rate-${Date.now()}`,
      trigger: "threshold",
      metric: "error_count",
      operator: "gt",
      threshold: 5,
      windowSeconds: 300,
      cooldownSeconds: 3600,
      channelIds: [channelData.id],
      appId: appData.id,
      projectId: projectData.id,
    });
    expect(rule.status).toBe(200);
    const ruleData = (await rule.json()) as { id: string };
    expect(ruleData.id).toBeDefined();

    const list = await apiRequest(
      "GET",
      `/api/admin/alerting/rules?projectId=${projectData.id}`,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((r) => r.id === ruleData.id)).toBe(true);

    const patched = await apiRequest(
      "PATCH",
      `/api/admin/alerting/rules/${ruleData.id}`,
      { threshold: 10 },
    );
    expect(patched.status).toBe(200);

    const deleted = await apiRequest(
      "DELETE",
      `/api/admin/alerting/rules/${ruleData.id}`,
    );
    expect(deleted.status).toBe(200);

    const incidents = await apiRequest(
      "GET",
      `/api/admin/alerting/incidents?appId=${appData.id}`,
    );
    expect(incidents.status).toBe(200);
  });
});
