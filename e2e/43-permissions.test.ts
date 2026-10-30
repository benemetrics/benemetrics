/**
 * E2E Test: Set permissions
 *
 * POST/GET /api/admin/permissions/{rules,grants}
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

describe("Set permissions", () => {
  it("creates a permission rule and lists it", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `Perms Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const rule = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `E2E Rule ${Date.now()}`,
      projectIds: [projectData.id],
      isEnabled: true,
    });
    expect(rule.status).toBe(200);
    const ruleData = (await rule.json()) as { id: string; name: string };
    expect(ruleData.id).toBeDefined();
    expect(ruleData.name).toStartWith("e2e rule");

    const list = await apiRequest("GET", "/api/admin/permissions/rules");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((r) => r.id === ruleData.id)).toBe(true);
  });

  it("creates a permission grant for an identity", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `Grant Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const grant = await apiRequest("POST", "/api/admin/permissions/grants", {
      identityId: "local-admin",
      label: "E2E admin grant",
      projectIds: [projectData.id],
      canWrite: true,
      isEnabled: true,
    });
    expect(grant.status).toBe(200);
    const grantData = (await grant.json()) as { id: string };
    expect(grantData.id).toBeDefined();

    const list = await apiRequest("GET", "/api/admin/permissions/grants");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((g) => g.id === grantData.id)).toBe(true);
  });
});
