/**
 * E2E Test: Projects & Apps Management
 * 
 * Tests the admin panel project/app endpoints:
 *   - Create / list / get / delete projects
 *   - Create apps inside a project, each app getting its own DSN
 *   - Ingest an event through a generated app DSN (full circle)
 * Starts a real server on an ephemeral port for testing.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

let baseUrl = "";
let server: any;

const SERVER_URL = "http://localhost:31337"; // kept for reference but not used
const ADMIN_TOKEN = "Bearer e2e-admin-token";

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
  dsn: string;
  publicKey: string;
  host: string;
  createdAt: string;
  environment?: EnvironmentCombo;
}

interface EnvironmentCombo {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token: string = ADMIN_TOKEN,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(`${baseUrl}${path}`);
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": token,
      ...extraHeaders,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await fetch(url, options);
}

async function sentryRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("sentry_key", "test-key");
  
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await fetch(url, options);
}

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
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
  return last!;
}

describe("Projects & Apps Management", () => {
  beforeAll(async () => {
    app.listen(0);
    server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;
    
    await sentryRequest("POST", "/events/clear");
  });

  afterAll(async () => {
    await sentryRequest("POST", "/events/clear");
    server.stop();
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
      // A project starts with no apps, just a default
      // "testing" environment.
      expect(data.appCount).toBe(0);
    });

    it("should auto-create a default testing environment with no apps", async () => {
      const response = await apiRequest("POST", "/api/admin/projects", {
        name: "DefaultEnv-" + uniq(),
      });
      expect(response.status).toBe(200);
      const data = await response.json() as ProjectResponse;

      const detail = await apiRequest("GET", `/api/admin/projects/${data.id}`);
      const project = await detail.json() as ProjectResponse & { apps: AppResponse[] };
      expect(project.apps).toHaveLength(0);

      const envRes = await apiRequest(
        "GET",
        `/api/admin/environments?projectId=${data.id}`,
      );
      expect(envRes.status).toBe(200);
      const envBody = await envRes.json() as { data: EnvironmentCombo[] };
      expect(envBody.data).toHaveLength(1);
      expect(envBody.data[0]!.slug).toBe("testing");
      expect(envBody.data[0]!.isDefault).toBe(true);
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

    it("does not create a project when admin auth is missing", async () => {
      const beforeResponse = await apiRequest("GET", "/api/admin/projects?limit=1");
      const before = await beforeResponse.json() as { pagination: { total: number } };

      const response = await apiRequest("POST", "/api/admin/projects", { name: "NoSideEffect-" + uniq() }, "");
      expect(response.status).toBe(401);

      const afterResponse = await apiRequest("GET", "/api/admin/projects?limit=1");
      const after = await afterResponse.json() as { pagination: { total: number } };
      expect(after.pagination.total).toBe(before.pagination.total);
    });
  });

  describe("POST /api/admin/projects/:id/duplicate", () => {
    it("duplicates a project with environments and apps, generating new DSNs", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", {
        name: "DupSource-" + uniq(),
        description: "source description",
      });
      const source = await createProjectResponse.json() as ProjectResponse;

      const envResponse = await apiRequest("POST", "/api/admin/environments", {
        projectId: source.id,
        name: "Staging",
      });
      const staging = await envResponse.json() as EnvironmentCombo;

      const appResponse = await apiRequest("POST", `/api/admin/projects/${source.id}/apps`, {
        name: "Source App",
        environment: "Staging",
      });
      const sourceApp = await appResponse.json() as AppResponse;

      const copyName = "DupCopy-" + uniq();
      const duplicateResponse = await apiRequest("POST", `/api/admin/projects/${source.id}/duplicate`, {
        name: copyName,
      });
      expect(duplicateResponse.status).toBe(200);
      const copy = await duplicateResponse.json() as ProjectResponse & { apps: AppResponse[] };

      // Fresh project identity and slug derived from the new name.
      expect(copy.id).not.toBe(source.id);
      expect(copy.name).toBe(copyName);
      expect(copy.slug).not.toBe(source.slug);
      expect(copy.description).toBe("source description");
      expect(copy.appCount).toBe(1);

      // The app is copied with fresh credentials -> a different DSN.
      expect(copy.apps).toHaveLength(1);
      const copyApp = copy.apps[0]!;
      expect(copyApp.id).not.toBe(sourceApp.id);
      expect(copyApp.projectId).toBe(copy.id);
      expect(copyApp.name).toBe("Source App");
      expect(copyApp.platform).toBe(sourceApp.platform);
      expect(copyApp.ingestKey).not.toBe(sourceApp.ingestKey);
      expect(copyApp.publicKey).not.toBe(sourceApp.publicKey);
      expect(copyApp.dsn).not.toBe(sourceApp.dsn);
      expect(copyApp.dsn).toBe(`http://${copyApp.publicKey}@${copyApp.host}/${copyApp.number}`);
      // The app lands in the copied environment, not the original.
      expect(copyApp.environment!.name).toBe("Staging");
      expect(copyApp.environment!.slug).toBe("staging");
      expect(copyApp.environment!.id).not.toBe(staging.id);

      // The source project is untouched: same credentials as before.
      const sourceDetail = await apiRequest("GET", `/api/admin/projects/${source.id}`);
      const sourceAfter = await sourceDetail.json() as ProjectResponse & { apps: AppResponse[] };
      expect(sourceAfter.apps[0]!.ingestKey).toBe(sourceApp.ingestKey);
      expect(sourceAfter.apps[0]!.publicKey).toBe(sourceApp.publicKey);
    });

    it("copies every environment and preserves the default flag", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "DupEnvs-" + uniq() });
      const source = await createProjectResponse.json() as ProjectResponse;

      await apiRequest("POST", "/api/admin/environments", { projectId: source.id, name: "Production" });
      await apiRequest("POST", "/api/admin/environments", { projectId: source.id, name: "Staging" });

      const duplicateResponse = await apiRequest("POST", `/api/admin/projects/${source.id}/duplicate`, { name: "DupEnvsCopy-" + uniq() });
      const copy = await duplicateResponse.json() as ProjectResponse;

      const envResponse = await apiRequest("GET", `/api/admin/environments?projectId=${copy.id}`);
      const body = await envResponse.json() as { data: EnvironmentCombo[] };
      expect(body.data).toHaveLength(3);
      const slugs = body.data.map((e) => e.slug).sort();
      expect(slugs).toEqual(["production", "staging", "testing"]);
      // Exactly one default, and it is the copied "testing" one.
      const defaults = body.data.filter((e) => e.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.slug).toBe("testing");
    });

    it("defaults the copy name to '<source> (copy)' and uniquifies the slug", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "DupAuto-" + uniq() });
      const source = await createProjectResponse.json() as ProjectResponse;

      const duplicateResponse = await apiRequest("POST", `/api/admin/projects/${source.id}/duplicate`, {});
      expect(duplicateResponse.status).toBe(200);
      const copy = await duplicateResponse.json() as ProjectResponse;
      expect(copy.name).toBe(`${source.name} (copy)`);
      expect(copy.slug).toBe(`${source.slug}-copy`);

      // A second duplicate of the same source gets a numbered slug.
      const secondResponse = await apiRequest("POST", `/api/admin/projects/${source.id}/duplicate`, {});
      const second = await secondResponse.json() as ProjectResponse;
      expect(second.slug).toBe(`${source.slug}-copy-2`);
    });

    it("ingests events through the duplicated app DSN", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "DupIngest-" + uniq() });
      const source = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${source.id}/apps`, {
        name: "Ingest Source",
      });
      const sourceApp = await createAppResponse.json() as AppResponse;

      const duplicateResponse = await apiRequest("POST", `/api/admin/projects/${source.id}/duplicate`, { name: "DupIngestCopy-" + uniq() });
      const copy = await duplicateResponse.json() as ProjectResponse & { apps: AppResponse[] };
      const copyApp = copy.apps[0]!;

      const eventId = crypto.randomUUID();
      const envelope = [
        JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event", length: 60 }),
        JSON.stringify({ event_id: eventId, message: "hello from duplicated dsn" }),
      ].join("\n");

      const url = new URL(`${baseUrl}/api/${copyApp.ingestKey}/envelope/`);
      url.searchParams.set("sentry_key", copyApp.publicKey);
      const ingestResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope,
      });
      expect(ingestResponse.status).toBe(200);

      const eventResponse = await fetch(`${baseUrl}/events/${eventId}`, { headers: { Authorization: ADMIN_TOKEN } });
      expect(eventResponse.status).toBe(200);
      const event = await eventResponse.json() as { message: string };
      expect(event.message).toBe("hello from duplicated dsn");

      // The original app DSN keeps working alongside the copy.
      const originalUrl = new URL(`${baseUrl}/api/${sourceApp.ingestKey}/envelope/`);
      originalUrl.searchParams.set("sentry_key", sourceApp.publicKey);
      const eventId2 = crypto.randomUUID();
      const envelope2 = [
        JSON.stringify({ event_id: eventId2, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event", length: 60 }),
        JSON.stringify({ event_id: eventId2, message: "hello from original dsn" }),
      ].join("\n");
      const originalIngest = await fetch(originalUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope2,
      });
      expect(originalIngest.status).toBe(200);
      const event2Response = await fetch(`${baseUrl}/events/${eventId2}`, { headers: { Authorization: ADMIN_TOKEN } });
      const event2 = await event2Response.json() as { message: string };
      expect(event2.message).toBe("hello from original dsn");
    });

    it("returns 404 for an unknown project", async () => {
      const response = await apiRequest("POST", `/api/admin/projects/${crypto.randomUUID()}/duplicate`, { name: "Ghost" });
      expect(response.status).toBe(404);
    });

    it("rejects requests without admin auth", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "DupAuth-" + uniq() });
      const source = await createProjectResponse.json() as ProjectResponse;
      const response = await apiRequest("POST", `/api/admin/projects/${source.id}/duplicate`, { name: "NoAuth" }, "");
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
      // No auto-created default app: apps are added explicitly.
      expect(data.apps).toHaveLength(0);
    });

    it("should return 404 for non-existent project", async () => {
      const response = await apiRequest("GET", `/api/admin/projects/${crypto.randomUUID()}`);
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
      });

      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.id).toBeDefined();
      expect(data.projectId).toBe(project.id);
      expect(data.name).toBe("Billing Worker");
      expect(data.platform).toBe("node");
      expect(data.ingestKey).toStartWith(`${project.slug}-`);
      expect(data.dsn).toBe(`http://${data.publicKey}@${data.host}/${data.number}`);
      // App-environment combo: the app is created with its default environment.
      expect(data.environment).toBeDefined();
      expect(data.environment!.slug).toBe("testing");
      expect(data.environment!.isDefault).toBe(true);
    });

    it("should create an app with a custom environment name", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "CustomEnv-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Staging Worker",
        environment: "Staging",
      });

      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.environment).toBeDefined();
      expect(data.environment!.name).toBe("Staging");
      expect(data.environment!.slug).toBe("staging");
      // The project's "testing" environment stays the default.
      expect(data.environment!.isDefault).toBe(false);
    });

    it("derives the DSN host from X-Forwarded-Host behind a proxy", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Http-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest(
        "POST",
        `/api/admin/projects/${project.id}/apps`,
        { name: "Edge Worker", platform: "go" },
        ADMIN_TOKEN,
        { "X-Forwarded-Host": "benemetrics.app" },
      );

      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      // Always http: the backend serves plain HTTP, TLS is a reverse
      // proxy concern. The DSN points back at the host the user reached.
      expect(data.host).toBe("benemetrics.app");
      expect(data.dsn).toBe(`http://${data.publicKey}@benemetrics.app/${data.number}`);
    });

    it("takes the first host of a chained X-Forwarded-Host", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Lan-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest(
        "POST",
        `/api/admin/projects/${project.id}/apps`,
        { name: "LAN Worker" },
        ADMIN_TOKEN,
        { "X-Forwarded-Host": "192.168.1.176:31337, internal.local" },
      );

      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.dsn).toBe(`http://${data.publicKey}@192.168.1.176:31337/${data.number}`);
    });

    it("derives the DSN host from the request when no proxy header is set", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Defhost-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const response = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "Default Host App" });
      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.host).toBe(new URL(baseUrl).host);
      expect(data.dsn).toBe(`http://${data.publicKey}@${data.host}/${data.number}`);
    });

    it("should return 404 for unknown project", async () => {
      const response = await apiRequest("POST", `/api/admin/projects/${crypto.randomUUID()}/apps`, { name: "App" });
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

      await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "App One" });
      await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "App Two" });

      const response = await apiRequest("GET", `/api/admin/projects/${project.id}/apps`);
      expect(response.status).toBe(200);
      const data = await response.json() as { data: AppResponse[] };
      // Apps are only those created explicitly.
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
      });
      const created = await createAppResponse.json() as AppResponse;

      const response = await apiRequest("GET", `/api/admin/apps/${created.id}`);
      expect(response.status).toBe(200);
      const data = await response.json() as AppResponse;
      expect(data.id).toBe(created.id);
      expect(data.dsn).toBe(created.dsn);
    });

    it("should return 404 for non-existent app", async () => {
      const response = await apiRequest("GET", `/api/admin/apps/${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });

  describe("Full circle: ingest via generated app DSN", () => {
    it("should ingest an envelope using the app DSN credentials", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Ingest-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Ingest App",
      });
      const created = await createAppResponse.json() as AppResponse;

      const url = new URL(`${baseUrl}/api/${created.ingestKey}/envelope/`);
      url.searchParams.set("sentry_key", created.publicKey);

      const eventId = crypto.randomUUID();
      const envelope = [
        JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event", length: 60 }),
        JSON.stringify({ event_id: eventId, message: "hello from app dsn" }),
      ].join("\n");

      const ingestResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope,
      });

      expect(ingestResponse.status).toBe(200);
      const ingestData = await ingestResponse.json() as { id: string };
      expect(ingestData.id).toBe(eventId);

      const eventResponse = await fetch(`${baseUrl}/events/${eventId}`, { headers: { Authorization: ADMIN_TOKEN } });
      expect(eventResponse.status).toBe(200);
      const event = await eventResponse.json() as { message: string };
      expect(event.message).toBe("hello from app dsn");
    });

    it("treats a repeated event id as an idempotent ingestion", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "Idempotent-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Idempotent App",
      });
      const created = await createAppResponse.json() as AppResponse;

      const url = new URL(`${baseUrl}/api/${created.ingestKey}/envelope/`);
      url.searchParams.set("sentry_key", created.publicKey);

      const eventId = crypto.randomUUID();
      const envelope = [
        JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event", length: 0 }),
        JSON.stringify({ event_id: eventId, message: "sent twice" }),
      ].join("\n");

      const send = () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-sentry-envelope" },
          body: envelope,
        });

      const first = await send();
      expect(first.status).toBe(200);

      // A retried delivery of the same event id must not fail the request.
      const second = await send();
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { id: string };
      expect(secondBody.id).toBe(eventId);

      // The stored event is still retrievable exactly once.
      const eventResponse = await fetch(`${baseUrl}/events/${eventId}`, { headers: { Authorization: ADMIN_TOKEN } });
      expect(eventResponse.status).toBe(200);
      const event = await eventResponse.json() as { message: string };
      expect(event.message).toBe("sent twice");
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
      const body = await json<{ error: string }>(getResponse);
      expect(body.error).toContain("App not found");
    });

    it("should keep project environments when an app is deleted", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "KeepEnv-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;
      const createAppResponse = await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, { name: "Doomed App" });
      const created = await createAppResponse.json() as AppResponse;
      const environmentId = created.environment!.id;

      const deleteResponse = await apiRequest("DELETE", `/api/admin/apps/${created.id}`);
      expect(deleteResponse.status).toBe(200);

      // Environments are project-scoped and shared, so
      // they survive app deletion.
      const envResponse = await apiRequest("GET", `/api/admin/environments/${environmentId}`);
      expect(envResponse.status).toBe(200);
    });

    it("cascades app-scoped rows on app delete (events, releases, rules, incidents)", async () => {
      const project = await json<ProjectResponse>(
        await apiRequest("POST", "/api/admin/projects", { name: "Cascade-" + uniq() }),
      );
      const app = await json<AppResponse>(
        await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
          name: "Cascade App",
        }),
      );

      // The rule must exist before ingestion: evaluation runs
      // fire-and-forget right after each stored event.
      const rule = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name: "cascade rule " + uniq(),
          metric: "error_count",
          operator: "gt",
          threshold: 0,
          windowSeconds: 3600,
          appId: app.id,
        }),
      );

      // Ingest an error event through the app DSN (fallback path, no
      // NATS in tests). Server-side this also records the release.
      const eventId = crypto.randomUUID();
      const ingestUrl = new URL(`${baseUrl}/api/${app.ingestKey}/store/`);
      ingestUrl.searchParams.set("sentry_key", app.publicKey);
      const ingestResponse = await fetch(ingestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          message: "cascade me",
          release: "cascade-1.0.0",
          level: "error",
        }),
      });
      expect(ingestResponse.status).toBe(200);

      const releases = await waitFor(
        async () =>
          json<{ data: Array<{ id: string; version: string }> }>(
            await apiRequest("GET", `/api/admin/releases?appId=${app.id}`),
          ),
        (body) => body.data.length === 1,
      );
      const releaseId = releases.data[0]!.id;

      const incidents = await waitFor(
        async () =>
          json<{ data: Array<{ id: string; ruleId: string }> }>(
            await apiRequest("GET", `/api/admin/alerting/incidents?appId=${app.id}`),
          ),
        (body) => body.data.length === 1,
      );
      const incidentId = incidents.data[0]!.id;

      const deleteResponse = await apiRequest("DELETE", `/api/admin/apps/${app.id}`);
      expect(deleteResponse.status).toBe(200);

      // App-scoped rows die with the app...
      expect((await apiRequest("GET", `/api/admin/releases/${releaseId}`)).status).toBe(404);
      expect((await apiRequest("GET", `/api/admin/alerting/rules/${rule.id}`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/events/${eventId}`, { headers: { Authorization: ADMIN_TOKEN } })).status).toBe(404);

      // ...and so do its incidents, which are plain history rows.
      const remainingIncidents = await json<{ data: Array<{ id: string }> }>(
        await apiRequest("GET", "/api/admin/alerting/incidents?limit=100"),
      );
      expect(remainingIncidents.data.some((incident) => incident.id === incidentId)).toBe(false);

      // Environments are shared and survive app deletion.
      expect(
        (await apiRequest("GET", `/api/admin/environments/${app.environment!.id}`)).status,
      ).toBe(200);
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

    it("does not delete a project when admin auth is missing", async () => {
      const createProjectResponse = await apiRequest("POST", "/api/admin/projects", { name: "NoDelete-" + uniq() });
      const project = await createProjectResponse.json() as ProjectResponse;

      const deleteResponse = await apiRequest("DELETE", `/api/admin/projects/${project.id}`, undefined, "");
      expect(deleteResponse.status).toBe(401);

      const stillThere = await apiRequest("GET", `/api/admin/projects/${project.id}`);
      expect(stillThere.status).toBe(200);
    });
  });
});