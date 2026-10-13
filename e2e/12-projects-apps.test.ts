/**
 * E2E Test: Projects & Apps Management
 *
 * Tests the admin panel project/app endpoints:
 *   - Create / list / get / delete projects
 *   - Create apps inside a project, each app getting its own DSN
 *   - Ingest an event through a generated app DSN (full circle)
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

const SERVER_URL = "http://localhost:31337";
const ADMIN_TOKEN = "Bearer admin-test-token";

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
  projectId: string;
  name: string;
  platform: string;
  ingestKey: string;
  dsn: string;
  publicKey: string;
  host: string;
  protocol: string;
  createdAt: string;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token: string = ADMIN_TOKEN
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": token,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await app.handle(new Request(url, options));
}

async function sentryRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  url.searchParams.set("sentry_key", "test-key");

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await app.handle(new Request(url, options));
}

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

describe("Projects & Apps Management", () => {
  beforeAll(async () => {
    await sentryRequest("POST", "/events/clear");
  });

  afterAll(async () => {
    await sentryRequest("POST", "/events/clear");
  });

  describe("POST /api/admin/projects", () => {
    it("should create a project with a derived slug", async () => {
      const response = await apiRequest("POST", "/api/admin/projects", {
        name: "Checkout Platform",
        description: "Payments and billing services",
      });

      expect(response.status).toBe(200);
      const data = await response.json() as ProjectResponse;
      expect(data.id).toBeDefined();
      expect(data.name).toBe("Checkout Platform");
      expect(data.slug).toBe("checkout-platform");
      expect(data.description).toBe("Payments and billing services");
      expect(data.appCount).toBe(0);
    });

    it("should create a project with an explicit slug", async () => {
      const response = await apiRequest("POST", "/api/admin/projects", {
        name: "Mobile",
        slug: "mobile-app",
      });

      expect(response.status).toBe(200);
      const data = await response.json() as ProjectResponse;
      expect(data.slug).toBe("mobile-app");
    });

    it("should return 400 when name is missing", async () => {
      const response = await apiRequest("POST", "/api/admin/projects", {});
      expect(response.status).toBe(400);
    });

    it("should reject request without admin auth", async () => {
      const response = await apiRequest("POST", "/api/admin/projects", { name: "x" }, "");
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/admin/projects", () => {
    it("should list projects with app counts", async () => {
      const response = await apiRequest("GET", "/api/admin/projects");
      expect(response.status).toBe(200);
      const data = await response.json() as { data: ProjectResponse[] };
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0]).toHaveProperty("appCount");
    });
  });

  describe("GET /api/admin/projects/:id", () => {
    it("should return project detail with apps array", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/projects", { name: "Detail-" + uniq() });
      const created = await createResponse.json() as ProjectResponse;

      const response = await apiRequest("GET", `/api/admin/projects/${created.id}`);
      expect(response.status).toBe(200);
      const data = await response.json() as ProjectResponse & { apps: AppResponse[] };
      expect(data.id).toBe(created.id);
      expect(data.apps).toBeInstanceOf(Array);
      expect(data.apps).toHaveLength(0);
    });

    it("should return 404 for non-existent project", async () => {
      const response = await apiRequest("GET", "/api/admin/projects/non-existent");
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/admin/projects/:id/apps", () => {
    it("should create an app with a generated DSN", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Apps-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Billing Worker",
        platform: "node",
        host: "localhost:31337",
      });

      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.id).toBeDefined();
      expect(data.projectId).toBe(project.id);
      expect(data.name).toBe("Billing Worker");
      expect(data.platform).toBe("node");
      expect(data.ingestKey).toStartWith(`${project.slug}-`);
      expect(data.protocol).toBe("http"); // local host -> http
      expect(data.dsn).toBe(`${data.protocol}://${data.publicKey}@${data.host}/${data.ingestKey}`);
    });

    it("should use https for non-local hosts", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Https-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Edge Worker",
        platform: "go",
        host: "benemetrics.app",
      });

      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.protocol).toBe("https");
      expect(data.dsn).toStartWith("https://");
    });

    it("should default the host when none is provided", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Defhost-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "Default Host App" });
      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.dsn).toStartWith("http");
      expect(data.dsn).toContain(data.ingestKey);
    });

    it("should return 404 for unknown project", async () => {
      const response = await apiRequest("POST", "/api/admin/projects/nope/apps", { name: "App" });
      expect(response.status).toBe(404);
    });

    it("should return 400 when app name is missing", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "NoName-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {});
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/admin/projects/:id/apps", () => {
    it("should list apps for a project", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "ListApps-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "App One", host: "localhost:31337" });
      await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "App Two", host: "localhost:31337" });

      const response = await apiRequest("GET", `/api/admin/projects/${project.id}/apps`);
      expect(response.status).toBe(200);
      const data = await response.json() as { data: AppResponse[] };
      expect(data.data).toHaveLength(2);
      expect(data.data[0]!.name).toBe("App One");
      expect(data.data[1]!.name).toBe("App Two");
    });
  });

  describe("GET /api/admin/apps/:appId", () => {
    it("should fetch a single app with its DSN", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "GetApp-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Solo App",
        host: "localhost:31337",
      });
      const created = await createAppResponse.json() as AppResponse;

      const response = await apiRequest("GET", `/api/admin/apps/${created.id}`);
      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.id).toBe(created.id);
      expect(data.dsn).toBe(created.dsn);
    });

    it("should return 404 for non-existent app", async () => {
      const response = await apiRequest("GET", "/api/admin/apps/non-existent");
      expect(response.status).toBe(404);
    });
  });

  describe("Full circle: ingest via generated app DSN", () => {
    it("should ingest an envelope using the app DSN credentials", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Ingest-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Ingest App",
        host: "localhost:31337",
      });
      const created = await createAppResponse.json() as AppResponse;

      // Send an envelope to the ingestion endpoint using the app's DSN coordinates
      const url = new URL(`${SERVER_URL}/api/${created.ingestKey}/envelope/`);
      url.searchParams.set("sentry_key", created.publicKey);

      const eventId = crypto.randomUUID();
      const envelope = [
        JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event", length: 60 }),
        JSON.stringify({ event_id: eventId, message: "hello from app dsn" }),
      ].join("\n");

      const ingestResponse = await app.handle(new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope,
      }));

      expect(ingestResponse.status).toBe(200);
      const ingestData = await ingestResponse.json() as { id: string };
      expect(ingestData.id).toBe(eventId);

      // The event must be retrievable
      const eventResponse = await app.handle(new Request(`${SERVER_URL}/events/${eventId}`));
      expect(eventResponse.status).toBe(200);
      const event = await eventResponse.json() as { message: string };
      expect(event.message).toBe("hello from app dsn");
    });
  });

  describe("DELETE endpoints", () => {
    it("should delete an app", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "DelApp-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "Doomed App" });
      const created = await createAppResponse.json() as AppResponse;

      const deleteResponse = await apiRequest("DELETE", `/api/admin/apps/${created.id}`);
      expect(deleteResponse.status).toBe(200);

      const getResponse = await apiRequest("GET", `/api/admin/apps/${created.id}`);
      expect(getResponse.status).toBe(404);
    });

    it("should delete a project and cascade its apps", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "DelProj-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "Cascade App" });
      const created = await createAppResponse.json() as AppResponse;

      const deleteResponse = await apiRequest("DELETE", `/api/admin/projects/${project.id}`);
      expect(deleteResponse.status).toBe(200);

      const projectGet = await apiRequest("GET", `/api/admin/projects/${project.id}`);
      expect(projectGet.status).toBe(404);

      const appGet = await apiRequest("GET", `/api/admin/apps/${created.id}`);
      expect(appGet.status).toBe(404);
    });
  });
});
