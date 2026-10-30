/**
 * E2E Test: New app
 *
 * POST /api/admin/projects/:id/apps (+ list apps for a project)
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

describe("New app", () => {
  it("creates an app inside a project and returns its DSN ingredients", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `App Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const app = await apiRequest(
      "POST",
      `/api/admin/projects/${projectData.id}/apps`,
      { name: `E2E App ${Date.now()}`, platform: "javascript" },
    );
    expect(app.status).toBe(200);
    const appData = (await app.json()) as {
      id: string;
      number: number;
      projectId: string;
      publicKey: string;
      ingestKey: string;
    };
    expect(appData.id).toBeDefined();
    expect(appData.projectId).toBe(projectData.id);
    expect(appData.number).toBeGreaterThan(0);
    expect(appData.publicKey).toBeDefined();
    expect(appData.ingestKey).toBeDefined();

    const dsn = `http://${appData.publicKey}@${new URL(SERVER_URL).host}/${appData.number}`;
    expect(dsn).toStartWith("http://");
    expect(dsn).toEndWith(`/${appData.number}`);
  });

  it("lists apps for a project", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `Apps List Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    await apiRequest("POST", `/api/admin/projects/${projectData.id}/apps`, {
      name: `App One ${Date.now()}`,
    });
    await apiRequest("POST", `/api/admin/projects/${projectData.id}/apps`, {
      name: `App Two ${Date.now()}`,
    });

    const detail = await apiRequest("GET", `/api/admin/projects/${projectData.id}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { apps?: unknown[] };
    expect(body.apps).toHaveLength(2);
  });
});
