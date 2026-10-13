/**
 * E2E Test: Session Replay using Elysia test adapter
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as Sentry from "@sentry/bun";
import app from "./backend/index";

const DSN = "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123";

describe("Session Replay (04-session-replay.md) - Elysia", () => {
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

  it("includes trace context in events for replay linking", async () => {
    const span = Sentry.startInactiveSpan({
      name: "GET /app/page",
      op: "pageload",
    });

    expect(span).toBeDefined();
    const traceId = span.spanContext().traceId;
    expect(traceId).toBeDefined();
    expect(traceId.length).toBe(32);

    const childSpan = Sentry.startInactiveSpan({
      name: "button#submit",
      op: "ui.click",
      parentSpan: span,
    });
    expect(childSpan).toBeDefined();
    expect(childSpan.spanContext().traceId).toBe(traceId);
    childSpan.end();

    span.end();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).trace_id).toBe(traceId);
  });

  it("sends event for replay linking (frontend)", async () => {
    const eventId = Sentry.captureMessage("Backend trace for replay linking", "info");
    expect(eventId).toBeDefined();
    
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);
    
    expect(event).toBeDefined();
    expect((event as any).event_id).toBe(eventId);
  });

  it("links backend transaction to frontend replay via trace_id", async () => {
    const span = Sentry.startInactiveSpan({
      name: "POST /api/checkout",
      op: "http.server",
    });

    const traceId = span.spanContext().traceId;
    expect(traceId).toBeDefined();
    expect(traceId.length).toBe(32);

    span.end();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).trace_id).toBe(traceId);
  });
});