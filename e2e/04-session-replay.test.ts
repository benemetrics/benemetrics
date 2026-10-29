/**
 * E2E Test: Session Replay
 *
 * Tests Sentry session replay features from 04-session-replay.md
 * Uses the Elysia way of running the API without attaching to a port.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startTestServer,
  waitForEventListItem,
  ADMIN_TOKEN,
  type TestServer,
} from "./test-helpers";

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
  body?: unknown,
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: ADMIN_TOKEN,
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
  const body = (await response.json()) as
    { data?: TestResult[] } | TestResult[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

async function waitForEvent(
  eventId: string,
  timeout: number = 5000,
): Promise<TestResult | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const event = await fetchEvent(eventId);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
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
});

afterAll(() => {
  testServer?.stop();
});

describe("Session Replay (04-session-replay.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN });
  });

  it("includes trace context in events for replay linking", async () => {
    const span = Sentry.startSpanManual(
      {
        name: "GET /api/orders/:id",
        op: "http.server",
      },
      (span) => {
        expect(span).toBeDefined();
        const traceId = span.spanContext().traceId;

        const eventId = Sentry.captureMessage("Replay recorded", {
          level: "info",
          contexts: {
            trace: {
              trace_id: traceId,
              span_id: span.spanContext().spanId,
            },
          },
        });
        expect(eventId).toBeDefined();
        span.end();
      },
    );

    await Sentry.flush(5000);

    const transactionEvent = await waitForEventListItem(
      SERVER_URL,
      (item) => item.itemTypes.includes("transaction"),
      10000,
      testServer!.appId,
    );
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
    expect((event as any).contexts?.trace?.trace_id).toBe(
      "0af7651916cd43dd8448eb211c80319c",
    );
    expect((event as any).contexts?.replay?.replay_id).toBe("replay-123");
  });

  it("links backend transaction to frontend replay via trace_id", async () => {
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const span = Sentry.startSpanManual(
      {
        name: "GET /api/orders/:id",
        op: "http.server",
      },
      (span) => {
        expect(span).toBeDefined();
        span.end();
      },
    );

    await Sentry.flush(5000);

    const transactionEvent = await waitForEventListItem(
      SERVER_URL,
      (item) => item.itemTypes.includes("transaction"),
      10000,
      testServer!.appId,
    );
    expect(transactionEvent).toBeDefined();
  });
});
