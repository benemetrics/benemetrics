/**
 * E2E Test: Environments (Project 1..* Environment, shared by apps)
 *
 * Exercises the admin environment endpoints mounted at /api/admin/environments:
 *   - Projects are created with a default "testing" environment
 *   - Exactly one default per project, promoted automatically on delete
 *   - Slug uniqueness scoped to the owning project
 *   - List / get / update / delete
 *   - Environments survive app deletion; project deletion cascades to them
 * Runs in-process through app.handle (no listener, no port).
 */

import { describe, it, expect } from "bun:test";
import { handleFetch as fetch, TEST_ORIGIN, waitFor } from "./test-helpers";

const baseUrl = TEST_ORIGIN;
const ADMIN_TOKEN = "Bearer e2e-admin-token";
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

interface EnvironmentResponse {
  id: string;
  projectId: string;
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
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await fetch(`${baseUrl}${path}`, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// Creates a fresh project (with its default "testing"
// environment) and returns its id.
async function makeProject(): Promise<{ projectId: string }> {
  const project = await json<{ id: string }>(
    await apiRequest("POST", "/api/admin/projects", { name: `EnvProj-${uniq()}` }),
  );
  return { projectId: project.id };
}

// Creates an app inside the project (optionally in a named
// environment) and returns its DSN credentials.
async function makeApp(
  projectId: string,
  environment?: string,
): Promise<{ ingestKey: string; publicKey: string }> {
  return await json<{ ingestKey: string; publicKey: string }>(
    await apiRequest("POST", `/api/admin/projects/${projectId}/apps`, {
      name: `EnvApp-${uniq()}`,
      environment,
    }),
  );
}

// Sends a minimal Sentry envelope through the app's public key.
async function sendEnvelope(
  app: { ingestKey: string; publicKey: string },
  message: string,
): Promise<Response> {
  const eventId = crypto.randomUUID();
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event", length: 0 }),
    JSON.stringify({
      event_id: eventId,
      level: "error",
      message,
      timestamp: Math.floor(Date.now() / 1000),
    }),
  ].join("\n");

  return await fetch(`${baseUrl}/api/${app.ingestKey}/envelope/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_key=${app.publicKey}, sentry_version=7`,
    },
    body: envelope,
  });
}

describe("Environments (project 1..* environment, shared by apps)", () => {
  describe("POST /api/admin/environments", () => {
    it("creates the project with a default testing environment", async () => {
      const { projectId } = await makeProject();
      const response = await apiRequest("GET", `/api/admin/environments?projectId=${projectId}`);

      expect(response.status).toBe(200);
      const body = await json<{ data: EnvironmentResponse[] }>(response);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.slug).toBe("testing");
      expect(body.data[0]!.isDefault).toBe(true);
    });

    it("creates subsequent environments as non-default", async () => {
      const { projectId } = await makeProject();
      const response = await apiRequest("POST", "/api/admin/environments", {
        projectId,
        name: "Staging",
        slug: "staging",
      });

      expect(response.status).toBe(200);
      const data = await json<EnvironmentResponse>(response);
      expect(data.slug).toBe("staging");
      expect(data.isDefault).toBe(false);
    });

    it("promotes an explicit default and demotes the previous default", async () => {
      const { projectId } = await makeProject();
      const list = await json<{ data: EnvironmentResponse[] }>(
        await apiRequest("GET", `/api/admin/environments?projectId=${projectId}`),
      );
      const testing = list.data.find((e) => e.slug === "testing");
      expect(testing?.isDefault).toBe(true);

      const second = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", {
          projectId,
          name: "Staging",
          isDefault: true,
        }),
      );

      expect(second.isDefault).toBe(true);

      const testingAfter = await json<EnvironmentResponse>(
        await apiRequest("GET", `/api/admin/environments/${testing!.id}`),
      );
      expect(testingAfter.isDefault).toBe(false);
    });

    it("rejects a duplicate slug within the same project", async () => {
      const { projectId } = await makeProject();
      await apiRequest("POST", "/api/admin/environments", { projectId, name: "Production" });

      const response = await apiRequest("POST", "/api/admin/environments", {
        projectId,
        name: "Production Again",
        slug: "production",
      });
      expect(response.status).toBe(409);
    });

    it("resolves concurrent creates of the same slug with a single winner", async () => {
      const { projectId } = await makeProject();
      const slug = `race-${uniq()}`;

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          apiRequest("POST", "/api/admin/environments", {
            projectId,
            name: slug,
            slug,
          }),
        ),
      );

      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(4);

      const list = await json<{ data: EnvironmentResponse[] }>(
        await apiRequest("GET", `/api/admin/environments?projectId=${projectId}`),
      );
      expect(
        list.data.filter((environment) => environment.slug === slug),
      ).toHaveLength(1);
    });

    it("allows the same slug across different projects", async () => {
      const projectA = await makeProject();
      const projectB = await makeProject();

      const a = await apiRequest("POST", "/api/admin/environments", { projectId: projectA.projectId, name: "Production" });
      const b = await apiRequest("POST", "/api/admin/environments", { projectId: projectB.projectId, name: "Production" });

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
    });

    it("returns 404 for an unknown project", async () => {
      const response = await apiRequest("POST", "/api/admin/environments", {
        projectId: crypto.randomUUID(),
        name: "Ghost",
      });
      expect(response.status).toBe(404);
    });

    it("returns 400 when name is missing", async () => {
      const { projectId } = await makeProject();
      const response = await apiRequest("POST", "/api/admin/environments", { projectId });
      expect(response.status).toBe(400);
    });

    it("rejects requests without admin auth", async () => {
      const { projectId } = await makeProject();
      const response = await apiRequest(
        "POST",
        "/api/admin/environments",
        { projectId, name: "NoAuth" },
        "",
      );
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/admin/environments", () => {
    it("lists environments for a project with pagination", async () => {
      const { projectId } = await makeProject();
      await apiRequest("POST", "/api/admin/environments", { projectId, name: "Production" });
      await apiRequest("POST", "/api/admin/environments", { projectId, name: "Staging" });

      const response = await apiRequest("GET", `/api/admin/environments?projectId=${projectId}`);
      expect(response.status).toBe(200);

      const body = await json<{
        data: EnvironmentResponse[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(response);
      // The auto-created "testing" environment plus the two above.
      expect(body.data).toHaveLength(3);
      expect(body.pagination).toMatchObject({ page: 1, limit: 20, total: 3, totalPages: 1 });
    });

    it("returns 404 for an unknown project", async () => {
      const response = await apiRequest("GET", `/api/admin/environments?projectId=${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/admin/environments/:id", () => {
    it("returns 404 for an unknown id", async () => {
      const response = await apiRequest("GET", `/api/admin/environments/${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/environments/:id", () => {
    it("updates the name and slug", async () => {
      const { projectId } = await makeProject();
      const environment = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", { projectId, name: "Staging" }),
      );

      const response = await apiRequest("PATCH", `/api/admin/environments/${environment.id}`, {
        name: "QA",
        slug: "qa",
      });
      expect(response.status).toBe(200);

      const data = await json<EnvironmentResponse>(response);
      expect(data.name).toBe("QA");
      expect(data.slug).toBe("qa");
    });

    it("rejects a slug that collides with a sibling", async () => {
      const { projectId } = await makeProject();
      await apiRequest("POST", "/api/admin/environments", { projectId, name: "Production" });
      const staging = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", { projectId, name: "Staging" }),
      );

      const response = await apiRequest("PATCH", `/api/admin/environments/${staging.id}`, {
        slug: "production",
      });
      expect(response.status).toBe(409);
    });
  });

  describe("DELETE /api/admin/environments/:id", () => {
    it("deletes the default environment and promotes a replacement default", async () => {
      const { projectId } = await makeProject();
      const list = await json<{ data: EnvironmentResponse[] }>(
        await apiRequest("GET", `/api/admin/environments?projectId=${projectId}`),
      );
      const testing = list.data.find((e) => e.slug === "testing")!;
      expect(testing.isDefault).toBe(true);

      const production = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", { projectId, name: "Production" }),
      );
      const staging = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", { projectId, name: "Staging" }),
      );

      const deleted = await apiRequest("DELETE", `/api/admin/environments/${testing.id}`);
      expect(deleted.status).toBe(200);

      const gone = await apiRequest("GET", `/api/admin/environments/${testing.id}`);
      expect(gone.status).toBe(404);

      // The oldest remaining environment becomes the default.
      const promoted = await json<EnvironmentResponse>(
        await apiRequest("GET", `/api/admin/environments/${production.id}`),
      );
      expect(promoted.isDefault).toBe(true);

      const notPromoted = await json<EnvironmentResponse>(
        await apiRequest("GET", `/api/admin/environments/${staging.id}`),
      );
      expect(notPromoted.isDefault).toBe(false);
    });

    it("cascades to the apps created inside the environment", async () => {
      const { projectId } = await makeProject();
      const environment = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", {
          projectId,
          name: "Feature",
        }),
      );
      const appRecord = await json<{ id: string }>(
        await apiRequest("POST", `/api/admin/projects/${projectId}/apps`, {
          name: `CascadeApp-${uniq()}`,
          environment: "Feature",
        }),
      );

      const deleted = await apiRequest("DELETE", `/api/admin/environments/${environment.id}`);
      expect(deleted.status).toBe(200);
      const deletedBody = await json<{ success: boolean; deletedApps: number }>(deleted);
      expect(deletedBody.deletedApps).toBe(1);

      // The apps created in that environment go with it...
      const goneApp = await apiRequest("GET", `/api/admin/apps/${appRecord.id}`);
      expect(goneApp.status).toBe(404);

      // ...while the rest of the project keeps its default environment.
      const remaining = await json<{ data: EnvironmentResponse[] }>(
        await apiRequest("GET", `/api/admin/environments?projectId=${projectId}`),
      );
      expect(remaining.data).toHaveLength(1);
      expect(remaining.data[0]!.slug).toBe("testing");
      expect(remaining.data[0]!.isDefault).toBe(true);
    });
  });

  describe("Environments are shared by the project's apps", () => {
    it("keeps environments when an app is deleted", async () => {
      const { projectId } = await makeProject();

      const appRecord = await json<{ id: string; environment: EnvironmentResponse }>(
        await apiRequest("POST", `/api/admin/projects/${projectId}/apps`, {
          name: `EnvSharedApp-${uniq()}`,
        }),
      );
      const environmentId = appRecord.environment.id;

      const deleted = await apiRequest("DELETE", `/api/admin/apps/${appRecord.id}`);
      expect(deleted.status).toBe(200);

      // Deleting an app must not remove the shared environment.
      const stillThere = await apiRequest("GET", `/api/admin/environments/${environmentId}`);
      expect(stillThere.status).toBe(200);
    });

    it("removes environments when their owning project is deleted", async () => {
      const { projectId } = await makeProject();
      const environment = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", { projectId, name: "Production" }),
      );

      // Deleting the project cascades to its environments.
      const deleted = await apiRequest("DELETE", `/api/admin/projects/${projectId}`);
      expect(deleted.status).toBe(200);

      const gone = await apiRequest("GET", `/api/admin/environments/${environment.id}`);
      expect(gone.status).toBe(404);
    });
  });

  describe("GET /events?environmentId", () => {
    it("filters stored events to the apps of one environment", async () => {
      const { projectId } = await makeProject();

      const environments = await json<{ data: EnvironmentResponse[] }>(
        await apiRequest("GET", `/api/admin/environments?projectId=${projectId}`),
      );
      const testing = environments.data.find((env) => env.slug === "testing")!;
      const production = await json<EnvironmentResponse>(
        await apiRequest("POST", "/api/admin/environments", { projectId, name: "Production" }),
      );

      const testingApp = await makeApp(projectId);
      const productionApp = await makeApp(projectId, "Production");

      const testingMessage = `env-testing-${uniq()}`;
      const productionMessage = `env-production-${uniq()}`;
      expect((await sendEnvelope(testingApp, testingMessage)).status).toBe(200);
      expect((await sendEnvelope(productionApp, productionMessage)).status).toBe(200);

      type EventsBody = { data: Array<{ event: { message?: string } | null }> };

      // Ingestion is asynchronous (NATS -> ClickHouse): poll until both
      // events are visible before asserting on the filtered lists.
      const all = await waitFor(
        async () =>
          json<EventsBody>(await apiRequest("GET", `/events?projectId=${projectId}`)),
        (body) => body.data.length === 2,
      );
      expect(all.data).toHaveLength(2);

      const testingEvents = await json<EventsBody>(
        await apiRequest("GET", `/events?projectId=${projectId}&environmentId=${testing.id}`),
      );
      expect(testingEvents.data).toHaveLength(1);
      expect(testingEvents.data[0]!.event?.message).toBe(testingMessage);

      const productionEvents = await json<EventsBody>(
        await apiRequest("GET", `/events?projectId=${projectId}&environmentId=${production.id}`),
      );
      expect(productionEvents.data).toHaveLength(1);
      expect(productionEvents.data[0]!.event?.message).toBe(productionMessage);
    });

    it("returns 404 for an unknown environment", async () => {
      const response = await apiRequest("GET", `/events?environmentId=${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });

  describe("GET /events?appId", () => {
    it("filters stored events to a single app", async () => {
      const { projectId } = await makeProject();

      const appA = await json<{ id: string; ingestKey: string; publicKey: string }>(
        await apiRequest("POST", `/api/admin/projects/${projectId}/apps`, {
          name: `AppA-${uniq()}`,
        }),
      );
      const appB = await json<{ id: string; ingestKey: string; publicKey: string }>(
        await apiRequest("POST", `/api/admin/projects/${projectId}/apps`, {
          name: `AppB-${uniq()}`,
        }),
      );

      const messageA = `app-a-${uniq()}`;
      const messageB = `app-b-${uniq()}`;
      expect((await sendEnvelope(appA, messageA)).status).toBe(200);
      expect((await sendEnvelope(appB, messageB)).status).toBe(200);

      type EventsBody = { data: Array<{ event: { message?: string } | null }> };

      const all = await waitFor(
        async () =>
          json<EventsBody>(await apiRequest("GET", `/events?projectId=${projectId}`)),
        (body) => body.data.length === 2,
      );
      expect(all.data).toHaveLength(2);

      const scoped = await json<EventsBody>(
        await apiRequest("GET", `/events?projectId=${projectId}&appId=${appA.id}`),
      );
      expect(scoped.data).toHaveLength(1);
      expect(scoped.data[0]!.event?.message).toBe(messageA);
    });

    it("returns 404 for an unknown app", async () => {
      const response = await apiRequest("GET", `/events?appId=${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });
});
