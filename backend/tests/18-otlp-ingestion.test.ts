/**
 * API Test: OTLP/JSON trace ingestion (alongside Sentry)
 *
 * Posts OpenTelemetry export payloads to the OTLP traces
 * endpoint and verifies they are stored as Sentry
 * transactions, visible through the existing events API.
 * Runs in-process through app.handle (no listener, no port).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import {
  connectTestNats,
  handleFetch as fetch,
  TEST_METRICS_SUBJECT,
  TEST_ORIGIN,
  ADMIN_TOKEN,
  waitFor,
  waitForApiGet,
} from "./test-helpers";

const baseUrl = TEST_ORIGIN;

let nats: NatsConnection;

beforeAll(async () => {
  nats = await connectTestNats();
});

afterAll(async () => {
  await nats.close();
});

const uniq = () =>
  Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const hex = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface OtlpApp {
  projectId: string;
  id: string;
  ingestKey: string;
  publicKey: string;
}

async function makeApp(): Promise<OtlpApp> {
  const project = await json<{ id: string }>(
    await adminRequest("POST", "/api/admin/projects", {
      name: `OtlpProj-${uniq()}`,
    }),
  );
  const appRecord = await json<{ id: string; ingestKey: string; publicKey: string }>(
    await adminRequest("POST", `/api/admin/projects/${project.id}/apps`, {
      name: `OtlpApp-${uniq()}`,
    }),
  );
  return { projectId: project.id, ...appRecord };
}

async function postOtlp(
  appRecord: OtlpApp,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/${appRecord.ingestKey}/otlp/v1/traces?sentry_key=${encodeURIComponent(appRecord.publicKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    },
  );
}

function span(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    traceId: hex(32),
    spanId: hex(16),
    name: "GET /api/orders",
    kind: 2,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000000150000000",
    attributes: [],
    ...overrides,
  };
}

function otlpBatch(...spans: Record<string, unknown>[]): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "checkout" } },
          ],
        },
        scopeSpans: [
          { scope: { name: "test", version: "1.0.0" }, spans },
        ],
      },
    ],
  };
}

describe("OTLP/JSON ingestion", () => {
  it("ingests a trace batch and exposes it as a transaction", async () => {
    const appRecord = await makeApp();
    const traceId = hex(32);
    const rootSpanId = hex(16);
    const childSpanId = hex(16);
    const root = span({ traceId, spanId: rootSpanId });
    const child = span({
      traceId,
      spanId: childSpanId,
      parentSpanId: rootSpanId,
      name: "SELECT orders",
      kind: 3,
      startTimeUnixNano: "1700000000010000000",
      endTimeUnixNano: "1700000000050000000",
    });

    const response = await postOtlp(appRecord, otlpBatch(root, child));
    expect(response.status).toBe(200);
    const { ids } = await json<{ ids: string[] }>(response);
    expect(ids).toEqual([rootSpanId]);

    const event = await waitForApiGet<Record<string, any>>(`/events/${rootSpanId}`);
    expect(event.transaction).toBe("GET /api/orders");
    expect(event.trace_id).toBe(traceId);
    expect(event.contexts.trace.trace_id).toBe(traceId);
    expect(event.spans).toHaveLength(1);
    expect(event.spans[0].name).toBe("SELECT orders");
    expect(event.spans[0].parent_span_id).toBe(rootSpanId);
    expect(event.spans[0].op).toBe("client");
    expect(event.tags["service.name"]).toBe("checkout");
    expect(event.start_timestamp).toBe(1700000000);
    expect(event.duration).toBeCloseTo(0.15);
  });

  it("converts measurements and error status", async () => {
    const appRecord = await makeApp();
    const failing = span({
      name: "POST /api/payments",
      attributes: [
        { key: "sentry.measurement.duration", value: { doubleValue: 150 } },
        { key: "http.status_code", value: { intValue: "500" } },
      ],
      status: { code: 2, message: "internal error" },
      endTimeUnixNano: "1700000000200000000",
    });
    const failingSpanId = failing.spanId as string;

    const response = await postOtlp(appRecord, otlpBatch(failing));
    expect(response.status).toBe(200);

    const event = await waitForApiGet<Record<string, any>>(`/events/${failingSpanId}`);
    expect(event.status).toBe("error");
    expect(event.measurements.duration.value).toBe(150);
    expect(event.tags["http.status_code"]).toBe("500");
    expect(event.contexts.trace.status).toBe("error");
  });

  it("stores each trace of a batch as its own transaction", async () => {
    const appRecord = await makeApp();
    const first = span();
    const second = span();

    const response = await postOtlp(appRecord, otlpBatch(first, second));
    expect(response.status).toBe(200);
    const { ids } = await json<{ ids: string[] }>(response);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(first.spanId as string);
    expect(ids).toContain(second.spanId as string);

    for (const id of ids) {
      const event = await waitForApiGet<Record<string, any>>(`/events/${id}`);
      expect(event.transaction).toBe("GET /api/orders");
      expect(event.spans).toHaveLength(0);
    }
  });

  it("rejects a request without a DSN key (401)", async () => {
    const appRecord = await makeApp();
    const response = await fetch(
      `${baseUrl}/api/${appRecord.ingestKey}/otlp/v1/traces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(otlpBatch(span())),
      },
    );
    expect(response.status).toBe(401);
  });

  it("rejects a non-OTLP payload (400)", async () => {
    const appRecord = await makeApp();
    const response = await postOtlp(appRecord, { foo: "bar" });
    expect(response.status).toBe(400);
  });

  it("rejects protobuf-encoded payloads (400)", async () => {
    const appRecord = await makeApp();
    const response = await postOtlp(
      appRecord,
      "0a120a08011200",
      { "Content-Type": "application/x-protobuf" },
    );
    expect(response.status).toBe(400);
  });

  it("accepts an empty batch", async () => {
    const appRecord = await makeApp();
    const response = await postOtlp(appRecord, { resourceSpans: [] });
    expect(response.status).toBe(200);
    const { ids } = await json<{ ids: string[] }>(response);
    expect(ids).toEqual([]);
  });

  it("extracts metric samples from the trace", async () => {
    const appRecord = await makeApp();
    const root = span({
      attributes: [
        { key: "sentry.measurement.custom", value: { doubleValue: 7 } },
      ],
    });

    // Subscribe before ingesting: the publish happens before the response
    // returns, and a live subscription observes this trace's batch.
    const received: string[] = [];
    const subscription = nats.subscribe(TEST_METRICS_SUBJECT);
    const pump = (async () => {
      for await (const message of subscription) {
        received.push(new TextDecoder().decode(message.data));
      }
    })();
    await nats.flush();

    const response = await postOtlp(appRecord, otlpBatch(root));
    expect(response.status).toBe(200);
    const { ids } = await json<{ ids: string[] }>(response);

    interface SampleRow {
      eventId: string;
      metric: string;
      value: number;
      dimension: string;
    }
    const rows = await waitFor(
      async () =>
        received
          .flatMap((payload) => payload.trim().split("\n"))
          .map((line) => JSON.parse(line) as SampleRow)
          .filter((row) => ids.includes(row.eventId)),
      (mine) => mine.some((row) => row.metric === "duration"),
    );
    subscription.unsubscribe();
    await pump;

    // The OTLP path extracts samples like every other ingest path.
    const byMetric = new Map(rows.map((row) => [row.metric, row]));
    expect(byMetric.get("event_count")?.value).toBe(1);
    expect(byMetric.get("event_count")?.dimension).toBe("GET /api/orders");
    expect(byMetric.get("duration")?.value).toBeCloseTo(150, 3);
    expect(byMetric.get("custom")?.value).toBe(7);
  });

  it("lists OTLP transactions in the events feed", async () => {
    const appRecord = await makeApp();
    const root = span();
    const rootSpanId = root.spanId as string;

    const response = await postOtlp(appRecord, otlpBatch(root));
    expect(response.status).toBe(200);

    const feed = await waitFor(
      async () =>
        json<{
          data: Array<{ id: string; itemTypes: string[] }>;
        }>(
          await fetch(
            `${baseUrl}/events/?projectId=${encodeURIComponent(appRecord.projectId)}&limit=1`,
            { headers: { Authorization: ADMIN_TOKEN } },
          ),
        ),
      (body) => body.data.some((item) => item.id === rootSpanId),
    );
    const stored = feed.data.find((item) => item.id === rootSpanId);
    expect(stored).toBeDefined();
    expect(stored?.itemTypes).toEqual(["transaction"]);
  });
});
