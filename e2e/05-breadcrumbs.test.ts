/**
 * E2E Test: Breadcrumbs
 *
 * Tests Sentry breadcrumbs features from 05-breadcrumbs.md
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
  });
}

const DSN = process.env.SENTRY_DSN || createTestDsn("123");

describe("Breadcrumbs (05-breadcrumbs.md)", () => {
  beforeAll(async () => {
    await clearEvents();
    initSentryForTest({ dsn: DSN });
  });

  afterAll(async () => {
    await clearEvents();
  });

  beforeEach(async () => {
    await clearEvents();
    // Clear Sentry SDK isolation scope breadcrumbs to prevent cross-test contamination
    const { getIsolationScope } = require("@sentry/bun");
    getIsolationScope()._breadcrumbs = [];
  });

  afterEach(async () => {
    await clearEvents();
  });

  it("adds manual breadcrumb and fetches event with breadcrumbs", async () => {
    Sentry.addBreadcrumb({
      type: "info",
      category: "user.action",
      message: "User clicked submit button",
      level: "info",
      data: { buttonId: "submit-btn", form: "checkout" },
    });

    const eventId = Sentry.captureMessage("Error after user action", "error");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    expect((event as any).breadcrumbs.length).toBeGreaterThan(0);
    const breadcrumb = (event as any).breadcrumbs.find((b: any) => b.message === "User clicked submit button");
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb.data.buttonId).toBe("submit-btn");
  });

  it("adds HTTP request breadcrumb and fetches event", async () => {
    Sentry.addBreadcrumb({
      type: "http",
      category: "http.request",
      message: "GET /api/users/123",
      level: "info",
      timestamp: Date.now() / 1000,
      data: {
        method: "GET",
        url: "/api/users/123",
        status_code: 200,
      },
    });

    const eventId = Sentry.captureException(new Error("Failed to process user"));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    const breadcrumb = (event as any).breadcrumbs.find((b: any) => b.category === "http.request");
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb.data.status_code).toBe(200);
  });

  it("adds database query breadcrumb and fetches event", async () => {
    Sentry.addBreadcrumb({
      type: "query",
      category: "db.query",
      message: "SELECT * FROM orders WHERE user_id = ?",
      level: "info",
      data: {
        query: "SELECT * FROM orders WHERE user_id = ?",
        params: ["user-123"],
        duration_ms: 45,
      },
    });

    const eventId = Sentry.captureMessage("Order processing error", "error");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    const breadcrumb = (event as any).breadcrumbs.find((b: any) => b.category === "db.query");
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb.data.duration_ms).toBe(45);
  });

  it("adds navigation breadcrumb and fetches event", async () => {
    Sentry.addBreadcrumb({
      type: "navigation",
      category: "navigation",
      message: "Navigated to /dashboard",
      level: "info",
      data: {
        from: "/login",
        to: "/dashboard",
      },
    });

    const eventId = Sentry.captureException(new Error("Dashboard load failed"));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    const breadcrumb = (event as any).breadcrumbs.find((b: any) => b.category === "navigation");
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb.data.from).toBe("/login");
    expect(breadcrumb.data.to).toBe("/dashboard");
  });

  it("adds console breadcrumb and fetches event", async () => {
    Sentry.addBreadcrumb({
      type: "log",
      category: "console",
      message: "Console warning: deprecated API used",
      level: "warning",
      data: {
        logger: "api.client",
      },
    });

    const eventId = Sentry.captureMessage("API deprecation warning", "warning");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    const breadcrumb = (event as any).breadcrumbs.find((b: any) => b.category === "console");
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb.level).toBe("warning");
  });

  it("adds multiple breadcrumbs before error and fetches event", async () => {
    Sentry.addBreadcrumb({
      type: "navigation",
      category: "navigation",
      message: "Page load: /checkout",
      level: "info",
    });

    Sentry.addBreadcrumb({
      type: "http",
      category: "http.request",
      message: "POST /api/cart",
      level: "info",
      data: { status_code: 200 },
    });

    Sentry.addBreadcrumb({
      type: "user",
      category: "user.action",
      message: "Clicked 'Place Order'",
      level: "info",
    });

    Sentry.addBreadcrumb({
      type: "http",
      category: "http.request",
      message: "POST /api/orders",
      level: "error",
      data: { status_code: 500 },
    });

    const eventId = Sentry.captureException(new Error("Order creation failed"));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    expect((event as any).breadcrumbs.length).toBe(4);
  });

  it("adds breadcrumb with custom timestamp and fetches event", async () => {
    const customTime = Date.now() / 1000 - 60;
    Sentry.addBreadcrumb({
      type: "default",
      category: "custom",
      message: "Custom timed event",
      level: "info",
      timestamp: customTime,
    });

    const eventId = Sentry.captureMessage("Event with historical breadcrumb", "info");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    const breadcrumb = (event as any).breadcrumbs.find((b: any) => b.category === "custom");
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb.timestamp).toBeCloseTo(customTime, 0);
  });

  it("clears breadcrumbs and fetches event without them", async () => {
    Sentry.addBreadcrumb({
      type: "info",
      category: "test",
      message: "This should be cleared",
      level: "info",
    });

    const isolationScope = Sentry.getIsolationScope();
    isolationScope._breadcrumbs = [];

    const eventId = Sentry.captureMessage("Event after breadcrumb clear", "info");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    // When no breadcrumbs, the property may not exist or be empty array
    const breadcrumbs = (event as any).breadcrumbs || [];
    expect(breadcrumbs.length).toBe(0);
  });
});