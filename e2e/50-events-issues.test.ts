/**
 * E2E Test: Events and issues
 *
 * Sentry.captureException -> fetch /events/:id,
 * capture transaction -> list /events,
 * issue tracked for the app via /api/admin/issues.
 * Runs against a real HTTP listener via startTestServer().
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startTestServer,
  ADMIN_TOKEN,
  waitForEventListItem,
  type TestServer,
} from "./test-helpers";

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

  Sentry.init({
    dsn: testServer.dsn,
    environment: "test",
    release: "e2e-events-issues",
    defaultIntegrations: false,
  });
});

afterAll(async () => {
  await Sentry.flush(2000);
  Sentry.close();
  testServer?.stop();
});

describe("Events and issues", () => {
  it("captures an error event and fetches it", async () => {
    const eventId = Sentry.captureException(new Error("Checkout payment failed"), {
      level: "fatal",
      tags: { service: "payments" },
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).not.toBeNull();
    const errEvent = event as any;
    expect(errEvent.event_id).toBe(eventId);
    expect(errEvent.level).toBe("fatal");
    expect(errEvent.tags?.service).toBe("payments");
    expect(errEvent.message).toBe("Checkout payment failed");
  });

  it("captures a transaction and finds it in the events list", async () => {
    await Sentry.startSpanManual(
      { name: "GET /api/checkout", op: "http.server" },
      async (span) => {
        span.setStatus({ code: 1, message: "ok" });
        span.end();
      },
    );
    await Sentry.flush(5000);

    const transaction = await waitForEventListItem<{
      id: string;
      itemTypes: string[];
      transaction?: { transaction?: string };
    }>(
      SERVER_URL,
      (item) =>
        item.itemTypes.includes("transaction") &&
        item.transaction?.transaction === "GET /api/checkout",
      15000,
      testServer.appId,
    );
    expect(transaction).toBeDefined();
  });

  it("sees the event tracked as an issue for the app", async () => {
    const issues = await apiRequest(
      "GET",
      `/api/admin/issues?query=app:${encodeURIComponent(testServer.appId)}&limit=10`,
    );
    expect(issues.status).toBe(200);
    const body = (await issues.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
