/**
 * E2E Test: Alert channels
 *
 * POST/GET/PATCH/DELETE /api/admin/alerting/channels
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

describe("Alert channels", () => {
  it("creates, lists, patches and deletes a webhook channel", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `Channel Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const created = await apiRequest("POST", "/api/admin/alerting/channels", {
      name: `ops-webhook-${Date.now()}`,
      type: "webhook",
      config: { url: "http://localhost:9999/hook" },
      projectId: projectData.id,
    });
    expect(created.status).toBe(200);
    const channel = (await created.json()) as {
      id: string;
      name: string;
      type: string;
      config: Record<string, unknown>;
      projectId: string | null;
    };
    expect(channel.id).toBeDefined();
    expect(channel.type).toBe("webhook");
    expect(channel.projectId).toBe(projectData.id);

    const list = await apiRequest(
      "GET",
      `/api/admin/alerting/channels?projectId=${projectData.id}`,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((c) => c.id === channel.id)).toBe(true);

    const patched = await apiRequest(
      "PATCH",
      `/api/admin/alerting/channels/${channel.id}`,
      { config: { url: "http://localhost:9999/hook?patched=1" } },
    );
    expect(patched.status).toBe(200);

    const deleted = await apiRequest(
      "DELETE",
      `/api/admin/alerting/channels/${channel.id}`,
    );
    expect(deleted.status).toBe(200);
    const body2 = (await deleted.json()) as { success?: boolean };
    expect(body2.success).toBe(true);
  });
});
