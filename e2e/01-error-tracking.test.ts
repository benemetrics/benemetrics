/**
 * E2E Test: Error Tracking
 *
 * Tests Sentry error tracking features from 01-error-tracking.md
 * Uses the Elysia way of running the API without attaching to a port.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { startTestServer, type TestServer } from "./test-helpers";

let SERVER_URL = "";
let testServer: TestServer | null = null;

interface TestResult {
  id?: string;
  [key: string]: unknown;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer e2e-admin-token",
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return await fetch(url, options);
}

async function fetchEvent(eventId: string): Promise<TestResult | null> {
  const response = await apiRequest("GET", `/events/${eventId}`);
  if (response.status === 404) return null;
  return await response.json();
}

async function fetchAllEvents(): Promise<TestResult[]> {
  const response = await apiRequest("GET", "/events");
  const body = (await response.json()) as { data?: TestResult[] } | TestResult[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

async function waitForEvent(eventId: string, timeout: number = 5000): Promise<TestResult | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const event = await fetchEvent(eventId);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function clearEvents(): Promise<void> {
  await apiRequest("POST", "/events/clear");
}

function initSentryForTest(config: { dsn: string; release?: string }): void {
  const { init } = require("@sentry/bun");
  init({
    dsn: config.dsn,
    release: config.release || "test-release",
    environment: "test",
    defaultIntegrations: false,
  });
}

let DSN = process.env.SENTRY_DSN || "";

// Self-contained backend: apps are only created through the admin API,
// so the SDK gets a real DSN provisioned on an ephemeral port.
beforeAll(async () => {
  testServer = await startTestServer();
  SERVER_URL = testServer.baseUrl;
  if (!DSN) DSN = testServer.dsn;
  await clearEvents();
});

afterAll(() => {
  testServer?.stop();
});

describe("Error Tracking (01-error-tracking.md)", () => {
  beforeAll(async () => {
    await clearEvents();
    initSentryForTest({ dsn: DSN });
  });

  afterAll(async () => {
    await clearEvents();
  });

  beforeEach(async () => {
    await clearEvents();
  });

  afterEach(async () => {
    await clearEvents();
  });

  it("captures a generic Error exception and fetches it by ID", async () => {
    const eventId = Sentry.captureException(new Error("Test error from 01-error-tracking"));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).event_id).toBe(eventId);
    expect((event as any).exception?.values?.[0]?.value).toContain("Test error from 01-error-tracking");
  });

  it("captures a TypeError with stack trace and fetches it", async () => {
    let eventId = "";
    try {
      const obj: any = null;
      obj.nonExistentProperty();
    } catch (e) {
      eventId = Sentry.captureException(e as Error);
    }
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).event_id).toBe(eventId);
    expect((event as any).exception).toBeDefined();
    expect((event as any).exception.values[0].type).toBe("TypeError");
  });

  it("captures a custom error with context and fetches it", async () => {
    const error = new Error("Custom error with context");
    const eventId = Sentry.captureException(error, {
      extra: { userId: "user-123", action: "checkout" },
      tags: { feature: "payments" },
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).extra?.userId).toBe("user-123");
    expect((event as any).extra?.action).toBe("checkout");
    expect((event as any).tags?.feature).toBe("payments");
  });

  it("captures a message event and fetches it", async () => {
    const eventId = Sentry.captureMessage("Something noteworthy happened", "warning");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).event_id).toBe(eventId);
    expect((event as any).message).toBe("Something noteworthy happened");
    expect((event as any).level).toBe("warning");
  });

  it("captures event with user context and fetches it", async () => {
    Sentry.setUser({ id: "user-456", email: "test@example.com", username: "testuser" });
    const eventId = Sentry.captureMessage("User action tracked");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).user?.id).toBe("user-456");
    expect((event as any).user?.email).toBe("test@example.com");
    expect((event as any).user?.username).toBe("testuser");
  });

  it("captures event with tags and extra data and fetches it", async () => {
    Sentry.setTag("service", "api");
    Sentry.setTag("version", "2.1.0");
    const eventId = Sentry.captureException(new Error("Tagged error"), {
      extra: { requestId: "req-789", payload: { foo: "bar" } },
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).tags?.service).toBe("api");
    expect((event as any).tags?.version).toBe("2.1.0");
    expect((event as any).extra?.requestId).toBe("req-789");
    expect((event as any).extra?.payload).toEqual({ foo: "bar" });
  });

  it("captures event with custom fingerprint and fetches it", async () => {
    const eventId = Sentry.captureEvent({
      message: "Grouped error",
      fingerprint: ["custom-group", "error-type"],
      level: "error",
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).fingerprint).toEqual(["custom-group", "error-type"]);
  });

  it("captures event with request context and fetches it", async () => {
    const eventId = Sentry.captureEvent({
      message: "Request error",
      level: "error",
      request: {
        url: "https://api.example.com/orders",
        method: "POST",
        headers: { "content-type": "application/json" },
        query_string: "filter=active",
        data: { items: [{ id: 1, qty: 2 }] },
      },
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).request?.url).toBe("https://api.example.com/orders");
    expect((event as any).request?.method).toBe("POST");
    expect((event as any).request?.data).toEqual({ items: [{ id: 1, qty: 2 }] });
  });
});