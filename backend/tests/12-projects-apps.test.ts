/**
 * API Test: Projects & Apps Management
 *
 * Tests the admin panel project/app endpoints:
 *   - Create / list / get / delete projects
 *   - Create apps inside a project, each app getting its own DSN
 *   - Ingest an event through a generated app DSN (full circle)
 * Runs in-process through app.handle (no listener, no port).
 */

import { describe, it, expect } from "bun:test";
import {
  handleFetch as fetch,
  TEST_ORIGIN,
  ADMIN_TOKEN,
  waitForApiGet,
  waitForStoredEvent,
} from "./test-helpers";
import { evaluateRulesForApp } from "../alerting/evaluation";

const baseUrl = TEST_ORIGIN;

interface ProjectResponse {
  id: string;
  name: string;
  slug: string;
  description: string;
  appCount: number;
  createdAt: string;
}

interface AppResponse {
  id: string;
  number: number;
  projectId: string;
  name: string;
  platform: string;
  ingestKey: string;
  publicKey: string;
  createdAt: string;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, options);
}

describe("Projects & Apps Management", () => {
  it("creates, lists, gets and deletes projects", async () => {
    const created = await apiRequest("POST", "/api/admin/projects", {
      name: "Checkout Platform",
      description: "Payments and billing services",
    });
    expect(created.status).toBe(200);
    const data = await created.json() as ProjectResponse;
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Checkout Platform");
    expect(data.slug).toBe("checkout-platform");
    expect(data.description).toBe("Payments and billing services");
    expect(data.appCount).toBe(0);

    const list = await apiRequest("GET", "/api/admin/projects");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: ProjectResponse[] };
    expect(body.data.some((p) => p.id === data.id)).toBe(true);

    const detail = await apiRequest("GET", `/api/admin/projects/${data.id}`);
    expect(detail.status).toBe(200);

    const deleted = await apiRequest("DELETE", `/api/admin/projects/${data.id}`);
    expect(deleted.status).toBe(200);

    const gone = await apiRequest("GET", `/api/admin/projects/${data.id}`);
    expect(gone.status).toBe(404);
  });

  it("creates a project with an explicit slug", async () => {
    const response = await apiRequest("POST", "/api/admin/projects", {
      name: "Mobile",
      slug: "mobile-app",
    });
    expect(response.status).toBe(200);
    const data = await response.json() as ProjectResponse;
    expect(data.slug).toBe("mobile-app");
  });

  it("returns 400 when name is missing", async () => {
    const response = await apiRequest("POST", "/api/admin/projects", {});
    expect(response.status).toBe(400);
  });

  it("rejects project creation without admin auth", async () => {
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(response.status).toBe(401);
  });

  it("does not create a project when admin auth is missing", async () => {
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NoSideEffect" }),
    });
    expect(response.status).toBe(401);
    const list = await apiRequest("GET", "/api/admin/projects");
    const body = (await list.json()) as { data: ProjectResponse[] };
    expect(body.data.some((p) => p.name === "NoSideEffect")).toBe(false);
  });

  it("creates an app inside a project with the default app creation path", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: "App Project",
    });
    expect(project.status).toBe(200);
    const projectData = await project.json() as { id: string };

    const app = await apiRequest(
      "POST",
      `/api/admin/projects/${projectData.id}/apps`,
      { name: "Checkout App" },
    );
    expect(app.status).toBe(200);
    const appData = await app.json() as AppResponse;
    expect(appData.id).toBeDefined();
    expect(appData.projectId).toBe(projectData.id);
    expect(appData.name).toBe("Checkout App");
    expect(appData.ingestKey).toBeDefined();
    expect(appData.publicKey).toBeDefined();
    expect(appData.number).toBeDefined();
  });

  it("creates an app with a custom platform", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: "Platform Project",
    });
    expect(project.status).toBe(200);
    const projectData = await project.json() as { id: string };

    const app = await apiRequest(
      "POST",
      `/api/admin/projects/${projectData.id}/apps`,
      { name: "iOS App", platform: "objc" },
    );
    expect(app.status).toBe(200);
    const appData = await app.json() as AppResponse;
    expect(appData.platform).toBe("objc");
  });

  it("lists apps for a project", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: "List Apps Project",
    });
    expect(project.status).toBe(200);
    const projectData = await project.json() as { id: string };

    await apiRequest("POST", `/api/admin/projects/${projectData.id}/apps`, {
      name: "App One",
    });
    await apiRequest("POST", `/api/admin/projects/${projectData.id}/apps`, {
      name: "App Two",
    });

    const detail = await apiRequest("GET", `/api/admin/projects/${projectData.id}`);
    const projectDetail = await detail.json() as ProjectResponse & { apps: AppResponse[] };
    expect(projectDetail.apps).toHaveLength(2);
  });

  it("deletes an app", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: "Delete App Project",
    });
    expect(project.status).toBe(200);
    const projectData = await project.json() as { id: string };

    const app = await apiRequest(
      "POST",
      `/api/admin/projects/${projectData.id}/apps`,
      { name: "To Delete" },
    );
    expect(app.status).toBe(200);
    const appData = await app.json() as { id: string };

    const deleted = await apiRequest("DELETE", `/api/admin/apps/${appData.id}`);
    expect(deleted.status).toBe(200);

    const detail = await apiRequest("GET", `/api/admin/projects/${projectData.id}`);
    const projectDetail = await detail.json() as ProjectResponse & { apps: AppResponse[] };
    expect(projectDetail.apps.some((a) => a.id === appData.id)).toBe(false);
  });

  it("duplicates a project with its apps", async () => {
    const source = await apiRequest("POST", "/api/admin/projects", {
      name: "Source Project",
    });
    expect(source.status).toBe(200);
    const sourceData = await source.json() as { id: string };

    await apiRequest("POST", `/api/admin/projects/${sourceData.id}/apps`, {
      name: "Source App",
    });

    const copied = await apiRequest("POST", `/api/admin/projects/${sourceData.id}/duplicate`, {
      name: "Copy Project",
    });
    expect(copied.status).toBe(200);
    const copyData = await copied.json() as { id: string; appCount: number };
    expect(copyData.appCount).toBe(1);

    const copyDetail = await apiRequest("GET", `/api/admin/projects/${copyData.id}`);
    const copyProject = await copyDetail.json() as ProjectResponse & { apps: AppResponse[] };
    expect(copyProject.apps).toHaveLength(1);
    expect(copyProject.apps[0]!.name).toBe("Source App");
  });

  it("ingests an event through a generated app DSN", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: "Ingest Project",
    });
    expect(project.status).toBe(200);
    const projectData = await project.json() as { id: string };

    const app = await apiRequest(
      "POST",
      `/api/admin/projects/${projectData.id}/apps`,
      { name: "Ingest App" },
    );
    expect(app.status).toBe(200);
    const appData = await app.json() as AppResponse;

    const dsn = `http://${appData.publicKey}@test.local/${appData.number}`;
    const eventId = crypto.randomUUID();
    const ingested = await fetch(`${baseUrl}/api/${appData.ingestKey}/store/?sentry_key=${appData.publicKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: eventId,
        level: "error",
        message: "dsn ingestion test",
        environment: "test",
      }),
    });
    expect(ingested.ok).toBe(true);

    const stored = await waitForStoredEvent(eventId);
    expect(stored).toBeDefined();
  });
});
