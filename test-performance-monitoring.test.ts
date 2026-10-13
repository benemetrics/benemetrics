/**
 * E2E Test: Performance Monitoring using Elysia test adapter
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as Sentry from "@sentry/bun";
import app from "./backend/index";

const DSN = "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123";

describe("Performance Monitoring (03-performance-monitoring.md) - Elysia", () => {
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

  it("creates and finishes a span (transaction) and fetches it", async () => {
    const span = Sentry.startInactiveSpan({
      name: "GET /api/users/:id",
      op: "http.server",
    });
    
    expect(span).toBeDefined();
    const traceId = span.spanContext().traceId;
    
    await new Promise((resolve) => setTimeout(resolve, 10));
    span.end();
    
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).transaction).toBe("GET /api/users/:id");
    expect((transaction as any).trace_id).toBe(traceId);
  });

  it("creates span with child spans and fetches them", async () => {
    const parentSpan = Sentry.startInactiveSpan({
      name: "POST /api/orders",
      op: "http.server",
    });

    expect(parentSpan).toBeDefined();
    const traceId = parentSpan.spanContext().traceId;

    const dbSpan = Sentry.startInactiveSpan({
      name: "INSERT INTO orders ...",
      op: "db.query",
      parentSpan: parentSpan,
    });
    expect(dbSpan).toBeDefined();
    expect(dbSpan.spanContext().traceId).toBe(traceId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    dbSpan.end();

    const cacheSpan = Sentry.startInactiveSpan({
      name: "SET order:123",
      op: "cache.redis",
      parentSpan: parentSpan,
    });
    expect(cacheSpan).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 3));
    cacheSpan.end();

    parentSpan.end();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).spans).toBeDefined();
    expect((transaction as any).spans.length).toBeGreaterThanOrEqual(2);
  });

  it("creates span with measurements and fetches it", async () => {
    const span = Sentry.startInactiveSpan({
      name: "GET /dashboard",
      op: "http.server",
    });

    expect(span).toBeDefined();

    span.setAttribute("sentry.measurement.fp", 1200.5);
    span.setAttribute("sentry.measurement.fcp", 1350.2);
    span.setAttribute("sentry.measurement.lcp", 2100.8);
    span.setAttribute("sentry.measurement.cls", 0.05);
    span.setAttribute("sentry.measurement.fid", 12.3);

    span.end();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).measurements).toBeDefined();
  });

  it("creates span with custom tags and data and fetches it", async () => {
    const span = Sentry.startInactiveSpan({
      name: "GET /api/products",
      op: "http.server",
    });

    expect(span).toBeDefined();

    span.setAttribute("service", "catalog");
    span.setAttribute("region", "us-east-1");
    span.setAttribute("user.tier", "premium");
    span.setAttribute("cache.hit", true);

    span.end();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
  });

  it("creates span with error status and fetches it", async () => {
    const span = Sentry.startInactiveSpan({
      name: "GET /api/failing",
      op: "http.server",
    });

    expect(span).toBeDefined();

    span.setStatus({ code: 2, message: "internal_error" });
    span.end();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).status).toBe("internal_error");
  });

  it("uses startInactiveSpan for non-transaction spans", async () => {
    const span = Sentry.startInactiveSpan({
      name: "background-job",
      op: "queue.process",
    });

    expect(span).toBeDefined();
    expect(span.spanContext().traceId).toBeDefined();

    span.setAttribute("job.type", "email");
    span.setAttribute("recipient", "user@example.com");
    
    await new Promise((resolve) => setTimeout(resolve, 5));
    span.end();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    expect(events.length).toBeGreaterThan(0);
  });

  it("continues trace from incoming headers", async () => {
    const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    
    const result = Sentry.continueTrace(
      { sentryTrace: traceparent, baggage: "" },
      () => {
        const span = Sentry.startInactiveSpan({
          name: "GET /api/continued",
          op: "http.server",
        });
        expect(span).toBeDefined();
        expect(span.spanContext().traceId).toBe("0af7651916cd43dd8448eb211c80319c");
        span.end();
        return span;
      }
    );

    expect(result).toBeDefined();
    await Sentry.flush(5000);
    
    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
    
    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).trace_id).toBe("0af7651916cd43dd8448eb211c80319c");
  });

  it("uses profiler integration", async () => {
    const { profiler } = await import("@sentry/bun");
    expect(profiler).toBeDefined();
    await Sentry.flush(5000);
  });
});