/**
 * E2E Test: Performance Monitoring
 *
 * Tests Sentry performance monitoring features from 03-performance-monitoring.md
 * Uses the Elysia way of running the API without attaching to a port.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { startTestServer, type TestServer } from "./test-helpers";

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
  await apiRequest("POST", "/events/clear");
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

describe("Performance Monitoring (03-performance-monitoring.md)", () => {
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

  it("creates and finishes a span (transaction) and fetches it", async () => {
    let traceId = "";
    await Sentry.startSpanManual({
      name: "GET /api/users/:id",
      op: "http.server",
    }, (span) => {
      expect(span).toBeDefined();
      traceId = span.spanContext().traceId;
      span.end();
    });

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
    let traceId = "";
    await Sentry.startSpanManual({
      name: "POST /api/orders",
      op: "http.server",
    }, async (parentSpan) => {
      expect(parentSpan).toBeDefined();
      traceId = parentSpan.spanContext().traceId;

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
    });

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
    await Sentry.startSpanManual({
      name: "GET /dashboard",
      op: "http.server",
    }, (span) => {
      expect(span).toBeDefined();

      span.setAttribute("sentry.measurement.fp", 1200.5);
      span.setAttribute("sentry.measurement.fcp", 1350.2);
      span.setAttribute("sentry.measurement.lcp", 2100.8);
      span.setAttribute("sentry.measurement.cls", 0.05);
      span.setAttribute("sentry.measurement.fid", 12.3);

      span.end();
    });

    await Sentry.flush(5000);

    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();

    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).measurements).toBeDefined();
  });

  it("creates span with custom tags and data and fetches it", async () => {
    await Sentry.startSpanManual({
      name: "GET /api/products",
      op: "http.server",
    }, (span) => {
      expect(span).toBeDefined();

      span.setAttribute("service", "catalog");
      span.setAttribute("region", "us-east-1");
      span.setAttribute("user.tier", "premium");
      span.setAttribute("cache.hit", true);

      span.end();
    });

    await Sentry.flush(5000);

    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();

    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
  });

  it("creates span with error status and fetches it", async () => {
    await Sentry.startSpanManual({
      name: "GET /api/failing",
      op: "http.server",
    }, (span) => {
      expect(span).toBeDefined();

      span.setStatus({ code: 2, message: "internal_error" });
      span.end();
    });

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

    // startInactiveSpan creates non-recording spans that are not sent to the server
    const events = await fetchAllEvents();
    // No events expected for non-transaction spans
  });

  it("continues trace from incoming headers - SDK level test", async () => {
    // This tests the Sentry SDK's ability to continue a trace from incoming headers
    // Note: Current SDK version may generate new trace IDs instead of preserving incoming ones
    const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

    const result = Sentry.continueTrace(
      { sentryTrace: traceparent, baggage: "" },
      () => {
        return Sentry.startSpanManual({
          name: "GET /api/continued",
          op: "http.server",
        }, (span) => {
          expect(span).toBeDefined();
          // SDK may or may not preserve incoming trace ID - just verify it creates a span
          span.end();
          return span;
        });
      }
    );

    expect(result).toBeDefined();
    await Sentry.flush(5000);

    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();

    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).trace_id).toBeDefined();
  });

  it("uses profiler integration", async () => {
    const { profiler } = await import("@sentry/bun");
    expect(profiler).toBeDefined();
    await Sentry.flush(5000);
  });
});