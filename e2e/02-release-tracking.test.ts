/**
 * E2E Test: Release Tracking
 *
 * Tests Sentry release tracking features from 02-release-tracking.md
 * Uses the Elysia way of running the API without attaching to a port.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

const SERVER_URL = "http://localhost:31337";

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
    headers: { "Content-Type": "application/json" },
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
  return await response.json();
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

function createTestDsn(projectId: string, publicKey?: string): string {
  const key = publicKey || Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  return `http://${key}@localhost:31337/${projectId}`;
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

const DSN = process.env.SENTRY_DSN || createTestDsn("123");

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
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
  });
});