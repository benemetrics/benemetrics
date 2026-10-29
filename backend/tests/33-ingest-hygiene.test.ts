/**
 * API Test: the ingest hygiene caps.
 *
 * The per-request cost is bounded: a client that spams cannot make the
 * server read an unbounded body, decompress a bomb, or push an unbounded
 * number of items. The rate limits (per source, per app) are the reverse
 * proxy's job — nothing here limits how much a client sends over time.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  handleFetch as fetch,
  startTestApp,
  TEST_ORIGIN,
} from "./test-helpers";

const uniq = () =>
  Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

let app: Awaited<ReturnType<typeof startTestApp>>;

const ENV_KEYS = [
  "INGEST_MAX_ENVELOPE_BYTES",
  "INGEST_MAX_DECOMPRESSED_BYTES",
  "INGEST_MAX_LARGE_ENVELOPE_BYTES",
  "INGEST_MAX_ENVELOPE_ITEMS",
  "INGEST_MAX_OTLP_SPANS",
  "INGEST_MAX_OTLP_BYTES",
];

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function ingestEnvelope(
  body: string,
  options: { gzip?: boolean; contentType?: string } = {},
): Promise<Response> {
  const url = new URL(`${TEST_ORIGIN}/api/${app.ingestKey}/envelope/`);
  url.searchParams.set("sentry_key", app.publicKey);
  const payload = options.gzip ? gzipSync(Buffer.from(body, "utf8")) : body;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": options.contentType ?? "application/x-sentry-envelope",
      ...(options.gzip ? { "Content-Encoding": "gzip" } : {}),
    },
    body: payload,
  });
}

function envelopeWithItems(count: number, itemSize = 10): string {
  const lines: string[] = [JSON.stringify({ event_id: crypto.randomUUID() })];
  for (let index = 0; index < count; index += 1) {
    const id = crypto.randomUUID();
    lines.push(
      JSON.stringify({ type: "event", content_type: "application/json" }),
    );
    lines.push(
      JSON.stringify({
        event_id: id,
        message: "x".repeat(itemSize),
        level: "error",
      }),
    );
  }
  return lines.join("\n");
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(() => {
  for (const key of ENV_KEYS) setEnv(key, undefined);
});

describe("Ingest hygiene caps", () => {
  it("rejects a body over the envelope cap with 413", async () => {
    setEnv("INGEST_MAX_ENVELOPE_BYTES", "512");
    const response = await ingestEnvelope(envelopeWithItems(1, 2000));
    expect(response.status).toBe(413);
  });

  it("rejects a gzip body whose decompressed size is over the cap with 413", async () => {
    setEnv("INGEST_MAX_DECOMPRESSED_BYTES", "512");
    const response = await ingestEnvelope(envelopeWithItems(1, 2000), {
      gzip: true,
    });
    expect(response.status).toBe(413);
  });

  it("rejects an envelope with too many items with 413", async () => {
    setEnv("INGEST_MAX_ENVELOPE_ITEMS", "2");
    const response = await ingestEnvelope(envelopeWithItems(3));
    expect(response.status).toBe(413);
  });

  it("accepts a large body once a replay item is declared", async () => {
    setEnv("INGEST_MAX_ENVELOPE_BYTES", "512");
    setEnv("INGEST_MAX_LARGE_ENVELOPE_BYTES", "1024 * 1024");
    setEnv("INGEST_MAX_ENVELOPE_ITEMS", "10");
    const id = crypto.randomUUID();
    const body = [
      JSON.stringify({ event_id: id }),
      JSON.stringify({ type: "replay_recording" }),
      JSON.stringify({
        id: "segment",
        segment_id: "0",
        replay_id: "r1",
        timestamp: 1,
        data: { x: "y".repeat(2000) },
      }),
    ].join("\n");
    const response = await ingestEnvelope(body);
    expect(response.status).toBe(200);
  });

  it("accepts a normal envelope", async () => {
    setEnv("INGEST_MAX_ENVELOPE_BYTES", "1024 * 1024");
    setEnv("INGEST_MAX_ENVELOPE_ITEMS", "100");
    const response = await ingestEnvelope(envelopeWithItems(2));
    expect(response.status).toBe(200);
  });

  it("answers a retried event id without publishing it again", async () => {
    const id = crypto.randomUUID();
    const body = [
      JSON.stringify({ event_id: id }),
      JSON.stringify({ type: "event", content_type: "application/json" }),
      JSON.stringify({ event_id: id, message: "retried", level: "error" }),
    ].join("\n");

    const first = await ingestEnvelope(body);
    expect(first.status).toBe(200);
    const second = await ingestEnvelope(body);
    expect(second.status).toBe(200);
    // The same id comes back — the client sees one accepted event.
    expect(await second.json()).toEqual({ id });
  });

  it("rejects an OTLP request with too many spans", async () => {
    setEnv("INGEST_MAX_OTLP_SPANS", "1");
    const url = new URL(`${TEST_ORIGIN}/api/${app.ingestKey}/otlp/v1/traces`);
    url.searchParams.set("sentry_key", app.publicKey);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: crypto.randomUUID().replace(/-/g, ""),
                    spanId: "a",
                  },
                  {
                    traceId: crypto.randomUUID().replace(/-/g, ""),
                    spanId: "b",
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    expect(response.status).toBe(413);
  });
});
