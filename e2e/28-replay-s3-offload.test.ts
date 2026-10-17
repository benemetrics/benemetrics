/**
 * E2E Test: Replay segment offload to S3-compatible object storage
 *
 * When S3_BUCKET is configured, the envelope ingestion route uploads
 * `replay_recording` item payloads and stores a small pointer
 * ({ offloaded: true, key, bytes }) instead — the duplicated `raw` body
 * is blanked so the segment is not stored again (Postgres + the
 * best-effort ClickHouse copy). Without S3, or when an upload fails, the
 * payload stays inline and ingestion is unaffected.
 *
 * The stub below speaks just enough path-style S3 (object PUT/GET) for
 * Bun's S3Client; request signatures are not checked.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { startTestServer, type TestServer } from "./test-helpers";
import { storedEventDAO } from "db/dao/stored-event";

const BUCKET = "sentry-replays";
const ADMIN_TOKEN = "Bearer e2e-admin-token";

interface UploadedObject {
  /** Request pathname as seen by the stub, including the bucket segment. */
  path: string;
  body: string;
  contentType: string | null;
}

let testServer: TestServer;
let s3Server: ReturnType<typeof Bun.serve> | null = null;
let s3Endpoint = "";
let uploads: UploadedObject[] = [];

// Snapshot the outer environment so the file leaves no S3_* behind.
const ORIGINAL_S3_ENV = {
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_SESSION_TOKEN: process.env.S3_SESSION_TOKEN,
};

function restoreS3Env(): void {
  for (const [name, value] of Object.entries(ORIGINAL_S3_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function replayEventPayload(replayId: string) {
  return {
    type: "replay_event",
    replay_id: replayId,
    segment_id: 3,
    replay_type: "session",
    urls: ["https://example.com/checkout"],
    error_ids: [],
    trace_ids: [],
    timestamp: 1700000000.5,
  };
}

// A realistic rrweb batch (full snapshot + incremental events) large
// enough that keeping it inline would matter.
function replayRecording() {
  return [
    { type: 4, data: { href: "https://example.com/checkout", width: 1280, height: 720 } },
    { type: 2, node: { type: 0, id: 1, childNodes: [] } },
    { type: 3, data: { source: 1, positions: new Array(32).fill({ x: 10, y: 20 }) } },
    { type: 3, data: { source: 0, texts: "x".repeat(4096) } },
  ];
}

function buildEnvelope(
  header: Record<string, unknown>,
  items: Array<{ header: Record<string, unknown>; payload: unknown }>,
): string {
  const lines = [JSON.stringify(header)];
  for (const item of items) {
    const payloadText = JSON.stringify(item.payload);
    lines.push(
      JSON.stringify({ ...item.header, length: Buffer.byteLength(payloadText, "utf8") }),
    );
    lines.push(payloadText);
  }
  return lines.join("\n");
}

// The DSN carries the public key as the userinfo and the numeric project
// number as the path, exactly what resolveAuthorizedApp expects.
async function sendEnvelope(envelope: string): Promise<Response> {
  const dsn = new URL(testServer.dsn);
  return await fetch(`${testServer.baseUrl}/api${dsn.pathname}/envelope/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_key=${encodeURIComponent(dsn.username)}, sentry_version=7`,
    },
    body: envelope,
  });
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${testServer.baseUrl}${path}`, {
    headers: { Authorization: ADMIN_TOKEN },
  });
  return (await response.json()) as T;
}

function objectKeyFor(options: {
  replayKey: string;
  eventId: string;
  index: number;
}): string {
  return `replays/${testServer.projectId}/${testServer.appId}/${options.replayKey}/${options.eventId}-${options.index}.json`;
}

beforeAll(async () => {
  s3Server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "PUT") {
        uploads.push({
          path: url.pathname,
          body: await request.text(),
          contentType: request.headers.get("content-type"),
        });
        return new Response(null, { status: 200, headers: { ETag: '"e2e"' } });
      }
      return new Response(null, { status: 404 });
    },
  });
  s3Endpoint = `http://127.0.0.1:${s3Server.port}`;

  testServer = await startTestServer();
});

afterAll(() => {
  restoreS3Env();
  s3Server?.stop(true);
  testServer?.stop();
});

beforeEach(() => {
  uploads = [];
  process.env.S3_BUCKET = BUCKET;
  process.env.S3_ENDPOINT = s3Endpoint;
  process.env.S3_ACCESS_KEY_ID = "e2e-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "e2e-secret-key";
  process.env.S3_REGION = "us-east-1";
  delete process.env.S3_SESSION_TOKEN;
});

describe("Replay segment offload to S3-compatible storage", () => {
  it("uploads recording segments and stores a pointer row", async () => {
    const eventId = crypto.randomUUID();
    const replayId = "4f9a4f9a4f9a4f9a4f9a4f9a4f9a4f9a";
    const replayEvent = replayEventPayload(replayId);
    const recording = replayRecording();

    const response = await sendEnvelope(
      buildEnvelope({ event_id: eventId, sent_at: new Date().toISOString() }, [
        {
          header: { type: "replay_event", content_type: "application/json" },
          payload: replayEvent,
        },
        {
          header: { type: "replay_recording", content_type: "application/json" },
          payload: recording,
        },
      ]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: eventId });

    // The segment landed in the object store, keyed by app + replay id.
    const key = objectKeyFor({ replayKey: replayId, eventId, index: 1 });
    expect(uploads).toHaveLength(1);
    const upload = uploads[0]!;
    expect(upload.path).toBe(`/${BUCKET}/${key}`);
    expect(upload.contentType).toContain("application/json");
    expect(JSON.parse(upload.body)).toEqual(recording);

    // The stored row keeps the metadata inline and a pointer instead of
    // the segment; `raw` (which repeats every payload) is blanked.
    const stored = await storedEventDAO.findById(eventId);
    expect(stored).toBeDefined();
    const storedItems = JSON.parse(stored!.envelopeItems) as Array<{
      header: { type: string };
      payload: unknown;
    }>;
    expect(storedItems.find((item) => item.header.type === "replay_event")!.payload).toEqual(
      replayEvent,
    );
    expect(
      storedItems.find((item) => item.header.type === "replay_recording")!.payload,
    ).toEqual({
      offloaded: true,
      key,
      bytes: Buffer.byteLength(upload.body, "utf8"),
    });
    expect(stored!.raw).toBe("");

    // The events API still serves the row: list summary + detail metadata.
    const list = await apiGet<{ data: Array<{ id: string; itemTypes: string[] }> }>(
      `/events?appId=${testServer.appId}`,
    );
    expect(list.data.find((row) => row.id === eventId)?.itemTypes).toEqual([
      "replay_event",
      "replay_recording",
    ]);

    const detail = await apiGet<Record<string, unknown>>(`/events/${eventId}`);
    expect(detail.replay_id).toBe(replayId);
    expect(detail.segment_id).toBe(3);
  });

  it("exposes the pointer when the envelope carries no inline payload", async () => {
    const eventId = crypto.randomUUID();
    const recording = replayRecording();

    const response = await sendEnvelope(
      buildEnvelope({ event_id: eventId, sent_at: new Date().toISOString() }, [
        {
          header: { type: "replay_recording", content_type: "application/json" },
          payload: recording,
        },
      ]),
    );
    expect(response.status).toBe(200);

    // Without replay metadata the message id keys the object.
    const key = objectKeyFor({ replayKey: eventId, eventId, index: 0 });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.path).toBe(`/${BUCKET}/${key}`);

    const detail = await apiGet<{ offloaded: boolean; key: string; bytes: number }>(
      `/events/${eventId}`,
    );
    expect(detail.offloaded).toBe(true);
    expect(detail.key).toBe(key);
    expect(detail.bytes).toBe(Buffer.byteLength(uploads[0]!.body, "utf8"));
  });

  it("leaves non-replay envelopes untouched", async () => {
    const eventId = crypto.randomUUID();
    const event = {
      event_id: eventId,
      level: "error",
      message: `s3 passthrough ${eventId}`,
      timestamp: 1700000000.5,
      platform: "javascript",
    };

    const response = await sendEnvelope(
      buildEnvelope({ event_id: eventId, sent_at: new Date().toISOString() }, [
        { header: { type: "event", content_type: "application/json" }, payload: event },
      ]),
    );
    expect(response.status).toBe(200);
    expect(uploads).toHaveLength(0);

    const stored = await storedEventDAO.findById(eventId);
    const storedItems = JSON.parse(stored!.envelopeItems) as Array<{
      header: { type: string };
      payload: unknown;
    }>;
    expect(storedItems[0]!.payload).toEqual(event);
    expect(stored!.raw).not.toBe("");

    const detail = await apiGet<Record<string, unknown>>(`/events/${eventId}`);
    expect(detail.message).toBe(event.message);
  });

  it("keeps recording payloads inline when S3 is not configured", async () => {
    delete process.env.S3_BUCKET;
    const eventId = crypto.randomUUID();
    const recording = replayRecording();

    const response = await sendEnvelope(
      buildEnvelope({ event_id: eventId, sent_at: new Date().toISOString() }, [
        {
          header: { type: "replay_recording", content_type: "application/json" },
          payload: recording,
        },
      ]),
    );
    expect(response.status).toBe(200);
    expect(uploads).toHaveLength(0);

    const stored = await storedEventDAO.findById(eventId);
    const storedItems = JSON.parse(stored!.envelopeItems) as Array<{
      header: { type: string };
      payload: unknown;
    }>;
    expect(storedItems[0]!.header.type).toBe("replay_recording");
    expect(storedItems[0]!.payload).toEqual(recording);
    expect(stored!.raw).not.toBe("");

    const detail = await apiGet<unknown>(`/events/${eventId}`);
    expect(detail).toEqual(recording);
  });

  it("keeps recording payloads inline when the upload fails", async () => {
    // Nothing listens on port 1: the upload rejects immediately.
    process.env.S3_ENDPOINT = "http://127.0.0.1:1";
    const eventId = crypto.randomUUID();
    const recording = replayRecording();

    const response = await sendEnvelope(
      buildEnvelope({ event_id: eventId, sent_at: new Date().toISOString() }, [
        {
          header: { type: "replay_recording", content_type: "application/json" },
          payload: recording,
        },
      ]),
    );
    expect(response.status).toBe(200);
    expect(uploads).toHaveLength(0);

    const stored = await storedEventDAO.findById(eventId);
    const storedItems = JSON.parse(stored!.envelopeItems) as Array<{
      header: { type: string };
      payload: unknown;
    }>;
    expect(storedItems[0]!.payload).toEqual(recording);
    expect(stored!.raw).not.toBe("");

    const detail = await apiGet<unknown>(`/events/${eventId}`);
    expect(detail).toEqual(recording);
  });
});
