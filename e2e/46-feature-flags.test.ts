/**
 * E2E Test: Feature flags
 *
 * POST/GET/PATCH /api/admin/feature-flags (draft -> active)
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

describe("Feature flags", () => {
  it("creates a boolean feature flag and activates it", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `Flags Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const created = await apiRequest("POST", "/api/admin/feature-flags", {
      projectId: projectData.id,
      key: `e2e-flag-${Date.now()}`,
      name: `E2E Flag ${Date.now()}`,
      description: "Created by the feature flags e2e suite",
      type: "boolean",
      defaultValue: false,
      variants: [
        { key: "control", name: "Control", value: false, weight: 50 },
        { key: "treatment", name: "Treatment", value: true, weight: 50 },
      ],
    });
    expect(created.status).toBe(200);
    const flag = (await created.json()) as {
      id: string;
      key: string;
      status: string;
    };
    expect(flag.id).toBeDefined();
    expect(flag.key).toStartWith("e2e-flag-");
    expect(flag.status).toBe("draft");

    const list = await apiRequest(
      "GET",
      `/api/admin/feature-flags?projectId=${projectData.id}`,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((f) => f.id === flag.id)).toBe(true);

    const activated = await apiRequest(
      "POST",
      `/api/admin/feature-flags/${flag.id}/status`,
      { status: "active" },
    );
    expect(activated.status).toBe(200);
  });
});
