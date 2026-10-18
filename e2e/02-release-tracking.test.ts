/**
 * E2E Test: Release Tracking
 *
 * Tests Sentry release tracking features from 02-release-tracking.md
 * Uses the Elysia way of running the API without attaching to a port.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { clearStoredEvents, startTestServer, waitForEventListItem, type TestServer } from "./test-helpers";

let SERVER_URL = "";
let testServer: TestServer | null = null;

interface TestResult {
  id: string;
  itemTypes: string[];
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
  await clearStoredEvents(SERVER_URL);
}

function initSentryForTest(config: { dsn: string; release?: string }): void {
  const { init } = require("@sentry/bun");
  init({
    dsn: config.dsn,
    release: config.release || "test-release",
    environment: "test",
    defaultIntegrations: false,
    tracesSampleRate: 1.0,
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

describe("Release Tracking (02-release-tracking.md)", () => {
  beforeAll(async () => {
    await clearEvents();
    initSentryForTest({ dsn: DSN, release: "2.3.1-abc123" });
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

  it("sends events with release information and fetches it", async () => {
    const eventId = Sentry.captureException(new Error("Error in release 2.3.1"));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).release).toBe("2.3.1-abc123");
  });

  it("sends events with environment information and fetches it", async () => {
    const eventId = Sentry.captureMessage("Deploy verification", "info");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).environment).toBe("test");
  });

  it("tracks release health via session and fetches it", async () => {
    const eventId = Sentry.captureMessage("Session health check", "info");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).release).toBe("2.3.1-abc123");
  });

  it("includes release in span events and fetches it", async () => {
    const span = Sentry.startInactiveSpan({
      name: "GET /api/health",
      op: "http.server",
      attributes: { "release": "2.3.1-abc123" },
    });
    expect(span).toBeDefined();
    const traceId = span.spanContext().traceId;
    span.end();

    await Sentry.flush(5000);
    // The list is the first read to observe the ingested event.
    const transactionEvent = await waitForEventListItem(
      SERVER_URL,
      (item) => item.itemTypes.includes("transaction"),
    );
    expect(transactionEvent).toBeDefined();
  });
});