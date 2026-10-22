/**
 * E2E Test: Official Sentry SDK against the provided app DSN
 *
 * Creates a project and an app through the admin API, connects the official
 * Sentry SDK with the exact DSN the API returns, and verifies the SDK
 * accepts the DSN as-is and its events are ingested end to end.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "API-Key e2e-admin-token",
};

interface AppResponse {
  id: string;
  number: number;
  publicKey: string;
}

interface EventRecord {
  event_id?: string;
  exception?: { values?: Array<{ value?: string }> };
  [key: string]: unknown;
}

let baseUrl = "";
let server: { port: number; stop: (force?: boolean) => void } | null = null;
let created: AppResponse;

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: ADMIN_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitForEvent(eventId: string, timeoutMs = 5000): Promise<EventRecord | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await adminRequest("GET", `/events/${eventId}`);
    if (response.ok) return (await response.json()) as EventRecord;
    await Bun.sleep(100);
  }
  return null;
}

beforeAll(async () => {
  app.listen(0);
  server = (app as any).server;
  baseUrl = `http://localhost:${server!.port}`;

  const projectResponse = await adminRequest("POST", "/api/admin/projects", {
    name: `SDK DSN Project ${crypto.randomUUID().slice(0, 8)}`,
  });
  expect(projectResponse.status).toBe(200);
  const project = (await projectResponse.json()) as { id: string };

  const appResponse = await adminRequest("POST", `/api/admin/projects/${project.id}/apps`, {
    name: "SDK DSN App",
  });
  expect(appResponse.status).toBe(200);
  created = (await appResponse.json()) as AppResponse;

  Sentry.init({
    dsn: `http://${created.publicKey}@${new URL(baseUrl).host}/${created.number}`,
    environment: "test",
    release: "e2e-sdk-dsn",
    defaultIntegrations: false,
  });
});

afterAll(async () => {
  await Sentry.flush(2000);
  Sentry.close();
  server?.stop(true);
});

describe("Official Sentry SDK connects with the provided app DSN", () => {
  it("hands out a DSN the SDK accepts as-is", () => {
    const dsnUrl = new URL(
      `http://${created.publicKey}@${new URL(baseUrl).host}/${created.number}`,
    );

    expect(created.number).toBeGreaterThan(0);
    expect(dsnUrl.protocol).toBe(new URL(baseUrl).protocol);
    expect(dsnUrl.host).toBe(new URL(baseUrl).host);
    expect(dsnUrl.username).toBe(created.publicKey);
    expect(dsnUrl.pathname).toBe(`/${created.number}`);

    const clientDsn = Sentry.getClient()?.getDsn();
    expect(clientDsn).toBeDefined();
    expect(clientDsn?.projectId).toBe(String(created.number));
    expect(clientDsn?.publicKey).toBe(created.publicKey);
    expect(clientDsn?.host).toBe(dsnUrl.hostname);
    expect(clientDsn?.port).toBe(dsnUrl.port);
  });

  it("ingests an event captured through the provided DSN", async () => {
    const eventId = Sentry.captureException(new Error("Captured via the provided app DSN"));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).not.toBeNull();
    expect(event?.event_id).toBe(eventId);
    expect(event?.exception?.values?.[0]?.value).toBe("Captured via the provided app DSN");
  });
});
