/**
 * E2E Test: Release Tracking using Elysia test adapter
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as Sentry from "@sentry/bun";
import app from "./backend/index";

const DSN = "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123";

describe("Release Tracking (02-release-tracking.md) - Elysia", () => {
  beforeAll(async () => {
    Sentry.init({
      dsn: DSN,
      environment: "test",
      release: "2.3.1-abc123",
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
  });

  async function fetchEvent(eventId: string): Promise<unknown> {
    const response = await app.handle(new Request(`http://localhost/events/${eventId}`));
    if (!response.ok) throw new Error(`Failed to fetch event: ${response.status}`);
    return response.json();
  }

  async function fetchAllEvents(): Promise<Array<{ id: string; itemTypes: string[] }>> {
    const response = await app.handle(new Request("http://localhost/events"));
    if (!response.ok) throw new Error(`Failed to fetch events: ${response.status}`);
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