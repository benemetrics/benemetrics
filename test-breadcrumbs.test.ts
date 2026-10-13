/**
 * E2E Test: Breadcrumbs using Elysia test adapter
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as Sentry from "@sentry/bun";
import app from "./backend/index";

const DSN = "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123";

describe("Breadcrumbs (05-breadcrumbs.md) - Elysia", () => {
  beforeAll(async () => {
    Sentry.init({
      dsn: DSN,
      environment: "test",
      release: "1.0.0-test",
      tracesSampleRate: 1.0,
      debug: false,
      defaultIntegrations: false,
    });
  });

  afterAll(async () => {
    await Sentry.flush(2000);
    await Sentry.close();
  });

  beforeEach(async () => {
    await app.handle(new Request("http://localhost/events/clear", { method: "POST" }));
    // Clear isolation scope breadcrumbs
    if (typeof Sentry.getIsolationScope === "function") {
      Sentry.getIsolationScope().clearBreadcrumbs();
    }
  });

  afterEach(async () => {
    // Clear isolation scope breadcrumbs
    if (typeof Sentry.getIsolationScope === "function") {
      Sentry.getIsolationScope().clearBreadcrumbs();
    }
  });

  async function fetchEvent(eventId: string): Promise<unknown> {
    const response = await app.handle(new Request(`http://localhost/events/${eventId}`));
    if (!response.ok) throw new Error(`Failed to fetch event: ${response.status}`);
    return response.json();
  }

  async function waitForEvent(eventId: string, timeout: number = 5000): Promise<unknown> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        return await fetchEvent(eventId);
      } catch (e) {
        if ((e as Error).message.includes("404")) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        throw e;
      }
    }
    throw new Error(`Timeout waiting for event ${eventId}`);
  }

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

    const scope = Sentry.getCurrentScope();
    scope.clearBreadcrumbs();

    const eventId = Sentry.captureMessage("Event after breadcrumb clear", "info");
    expect(eventId).toBeDefined();
    
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);
    
    expect(event).toBeDefined();
    expect((event as any).breadcrumbs).toBeDefined();
    expect((event as any).breadcrumbs.length).toBe(0);
  });
});