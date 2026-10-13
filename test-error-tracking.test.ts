/**
 * E2E Test: Error Tracking using Elysia test adapter
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as Sentry from "@sentry/bun";
import app from "./backend/index";

const DSN = "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123";

describe("Error Tracking (01-error-tracking.md) - Elysia", () => {
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
    // Clear events before each test
    await app.handle(new Request("http://localhost/events/clear", { method: "POST" }));
  });

  async function waitForEvent(eventId: string, timeout: number = 5000): Promise<unknown> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const response = await app.handle(new Request(`http://localhost/events/${eventId}`));
      if (response.ok) {
        return response.json();
      }
      if (response.status !== 404) {
        throw new Error(`Failed to fetch event: ${response.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timeout waiting for event ${eventId}`);
  }

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