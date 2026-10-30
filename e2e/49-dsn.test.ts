/**
 * E2E Test: DSN
 *
 * Composes http://<publicKey>@<host>/<number>, verifies the SDK reads the
 * ingredients, and ingests an event captured through the app DSN.
 * Runs against a real HTTP listener via startTestServer().
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startTestServer, ADMIN_TOKEN, type TestServer } from "./test-helpers";

let SERVER_URL = "";
let testServer!: TestServer;
let publicKey = "";
let appNumber = 0;

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

async function waitForEvent(
  eventId: string,
  timeoutMs = 10000,
): Promise<Record<string, unknown> | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await apiRequest("GET", `/events/${eventId}`);
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    if (response.ok) {
      return (await response.json()) as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

beforeAll(async () => {
  testServer = await startTestServer();
  SERVER_URL = testServer.baseUrl;
  const dsnUrl = new URL(testServer.dsn);
  publicKey = dsnUrl.username;
  appNumber = Number(dsnUrl.pathname.slice(1));

  Sentry.init({
    dsn: testServer.dsn,
    environment: "test",
    release: "e2e-dsn",
    defaultIntegrations: false,
  });
});

afterAll(async () => {
  await Sentry.flush(2000);
  Sentry.close();
  testServer?.stop();
});

describe("DSN", () => {
  it("composes a DSN the SDK accepts and reads its ingredients", async () => {
    const dsn = `http://${publicKey}@${new URL(SERVER_URL).host}/${appNumber}`;

    const clientDsn = Sentry.getClient()?.getDsn();
    expect(clientDsn).toBeDefined();
    expect(clientDsn?.projectId).toBe(String(appNumber));
    expect(clientDsn?.publicKey).toBe(publicKey);
    expect(clientDsn?.host).toBe(new URL(SERVER_URL).hostname);
    expect(clientDsn?.port).toBe(new URL(SERVER_URL).port);

    const url = new URL(dsn);
    expect(url.protocol).toBe("http:");
    expect(url.username).toBe(publicKey);
    expect(url.pathname).toBe(`/${appNumber}`);
  });

  it("ingests an event captured through the app DSN", async () => {
    const eventId = Sentry.captureException(
      new Error("Captured via the app DSN"),
      { level: "error" },
    );
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).not.toBeNull();
    const dsnEvent = event as any;
    expect(dsnEvent.event_id).toBe(eventId);
    expect(dsnEvent.level).toBe("error");
  });
});
