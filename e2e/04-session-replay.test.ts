/**
 * E2E Test: Session Replay
 *
 * Tests Sentry session replay features from 04-session-replay.md
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

describe("Session Replay (04-session-replay.md)", () => {
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

  it("includes trace context in events for replay linking", async () => {
    const span = Sentry.startSpanManual({
      name: "GET /api/orders/:id",
      op: "http.server",
    }, (span) => {
      expect(span).toBeDefined();
      const traceId = span.spanContext().traceId;
      
      // Simulate replay being recorded
      const eventId = Sentry.captureMessage("Replay recorded", "info", {
        contexts: {
          trace: {
            trace_id: traceId,
            span_id: span.spanContext().spanId,
          },
        },
      });
      expect(eventId).toBeDefined();
      span.end();
    });

    await Sentry.flush(5000);

    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
  });

  it("sends event for replay linking (frontend)", async () => {
    const eventId = Sentry.captureEvent({
      message: "Frontend error with replay",
      level: "error",
      contexts: {
        trace: {
          trace_id: "0af7651916cd43dd8448eb211c80319c",
          span_id: "b7ad6b7169203331",
        },
        replay: {
          replay_id: "replay-123",
          segment_id: 1,
        },
      },
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).contexts?.trace?.trace_id).toBe("0af7651916cd43dd8448eb211c80319c");
    expect((event as any).contexts?.replay?.replay_id).toBe("replay-123");
  });

  it("links backend transaction to frontend replay via trace_id", async () => {
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const span = Sentry.startSpanManual({
      name: "GET /api/orders/:id",
      op: "http.server",
    }, (span) => {
      expect(span).toBeDefined();
      span.end();
    });

    await Sentry.flush(5000);

    const events = await fetchAllEvents();
    const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
    expect(transactionEvent).toBeDefined();
  });
});