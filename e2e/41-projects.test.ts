/**
 * E2E Test: New project
 *
 * POST /api/admin/projects (+ list / get / delete)
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

describe("New project", () => {
  it("creates a project through the admin API", async () => {
    const response = await apiRequest("POST", "/api/admin/projects", {
      name: `E2E Project ${Date.now()}`,
      description: "Created by the projects e2e suite",
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { id?: string; name?: string };
    expect(data.id).toBeDefined();
    expect(data.name).toContain("E2E Project");
  });

  it("lists projects and returns the created one", async () => {
    const created = await apiRequest("POST", "/api/admin/projects", {
      name: `Listable Project ${Date.now()}`,
    });
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };

    const list = await apiRequest("GET", "/api/admin/projects");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((p) => p.id === project.id)).toBe(true);
  });
});
