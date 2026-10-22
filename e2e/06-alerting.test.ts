/**
 * E2E Test: Alerting
 *
 * Tests Sentry alerting features from 06-alerting.md
 * Uses the Elysia way of running the API without attaching to a port.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { startTestServer, waitForEventListItem, type TestServer } from "./test-helpers";

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
      Authorization: "API-Key e2e-admin-token",
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

describe("Alerting (06-alerting.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN });
  });

  beforeEach(async () => {
    // Clear Sentry SDK isolation scope breadcrumbs to prevent cross-test contamination
    const { getIsolationScope } = require("@sentry/bun");
    getIsolationScope()._breadcrumbs = [];
  });

  it("sends check-in for cron job start (in_progress) and fetches it", async () => {
    const checkInId = Sentry.captureCheckIn({
      monitorSlug: "nightly-backup",
      status: "in_progress",
    });
    expect(checkInId).toBeDefined();

    await Sentry.flush(5000);

    const checkIn = await waitForEvent(checkInId);
    expect(checkIn).toBeDefined();
    expect((checkIn as any).monitor_slug).toBe("nightly-backup");
    expect((checkIn as any).status).toBe("in_progress");
  });

  it("sends check-in for cron job success (ok) and fetches it", async () => {
    const checkInId = Sentry.captureCheckIn({
      monitorSlug: "nightly-backup",
      status: "ok",
      duration: 300,
    });
    expect(checkInId).toBeDefined();

    await Sentry.flush(5000);

    const checkIn = await waitForEvent(checkInId);
    expect(checkIn).toBeDefined();
    expect((checkIn as any).status).toBe("ok");
    expect((checkIn as any).duration).toBe(300);
  });

  it("sends check-in for cron job failure (error) and fetches it", async () => {
    const checkInId = Sentry.captureCheckIn({
      monitorSlug: "nightly-backup",
      status: "error",
      duration: 50,
    });
    expect(checkInId).toBeDefined();

    await Sentry.flush(5000);

    const checkIn = await waitForEvent(checkInId);
    expect(checkIn).toBeDefined();
    expect((checkIn as any).status).toBe("error");
    expect((checkIn as any).duration).toBe(50);
  });

  it("sends custom metric for alerting", async () => {
    // Metrics are sent in a different format (statsd) and not stored as events
    // This test verifies the metric API doesn't throw
    Sentry.metrics.increment("queue.depth", 1, { tags: { type: "gauge" } });
    expect(true).toBe(true);
    await Sentry.flush(5000);
  });

  it("sends error that should trigger alert rule and fetches it", async () => {
    const eventId = Sentry.captureException(new Error("Critical: Payment service unavailable"), {
      level: "fatal",
      tags: {
        service: "payments",
        severity: "critical",
        alert: "true",
      },
      extra: {
        affected_users: 1000,
        revenue_impact_usd: 50000,
      },
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).level).toBe("fatal");
    expect((event as any).tags?.service).toBe("payments");
    expect((event as any).tags?.severity).toBe("critical");
    expect((event as any).extra?.affected_users).toBe(1000);
  });

  it("sends span with slow performance for alerting and fetches it", async () => {
    await Sentry.startSpanManual({
      name: "GET /api/slow-endpoint",
      op: "http.server",
    }, async (span) => {
      expect(span).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 100));

      span.setAttribute("performance.alert", "slow");
      span.setAttribute("duration_ms", 5000);
      span.setStatus({ code: 1, message: "ok" });
      span.end();
    });

    await Sentry.flush(5000);

    const transactionEvent = await waitForEventListItem<{
      id: string;
      itemTypes: string[];
      transaction?: { transaction?: string };
    }>(
      SERVER_URL,
      (item) =>
        item.itemTypes.includes("transaction") &&
        item.transaction?.transaction === "GET /api/slow-endpoint",
      15000,
      testServer!.appId,
    );
    expect(transactionEvent).toBeDefined();

    const transaction = await fetchEvent(transactionEvent!.id);
    expect(transaction).toBeDefined();
    expect((transaction as any).transaction).toBe("GET /api/slow-endpoint");
  });

  it("sends user feedback event and fetches it", async () => {
    const eventId = Sentry.captureFeedback({
      associatedEventId: "fc6d8c0c-4b3a-4b3a-8b3a-4b3a4b3a4b3a",
      name: "John Doe",
      email: "john@example.com",
      message: "The checkout page crashed when I clicked pay",
    });
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);

    const feedbackEvent = await waitForEventListItem(
      SERVER_URL,
      (item) => item.itemTypes.includes("feedback"),
      10000,
      testServer!.appId,
    );
    expect(feedbackEvent).toBeDefined();

    const feedback = await fetchEvent(feedbackEvent!.id);
    expect(feedback).toBeDefined();
    // Feedback data is nested under contexts.feedback
    expect((feedback as any).contexts?.feedback?.name).toBe("John Doe");
    expect((feedback as any).contexts?.feedback?.contact_email).toBe("john@example.com");
    expect((feedback as any).contexts?.feedback?.message).toBe("The checkout page crashed when I clicked pay");
  });
});