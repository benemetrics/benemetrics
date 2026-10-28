/**
 * Replay segment offload to object storage + the replay read path.
 *
 * At ingestion `replay_recording` item payloads are written to the
 * S3-compatible object store (RustFS in the compose/CI environment) and the
 * item keeps just the object key (`{ key }`) instead of the segment, so the
 * segment is not stored again (ClickHouse is the events store; ingestion
 * reaches it asynchronously through NATS). Object keys embed the segment
 * start time, so listing a session's keys is already playback order.
 *
 * The read path is `GET /api/admin/events/:eventId/replay/:replayId`:
 * it pages presigned URLs (`cursor` + `limit`) and the browser fetches the
 * bytes straight from the object store. When the write fails, the payload
 * stays inline and ingestion is unaffected.
 *
 * The suite requires the compose services, including
 * `docker compose up -d rustfs rustfs-init` (bucket `sentry-replays`).
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { s3 } from "../storage";
import {
  handleFetch as appFetch,
  startTestApp,
  waitForStoredEvent,
  ADMIN_TOKEN,
  type TestApp,
} from "./test-helpers";

const START_MS = 1_700_000_000_000;

interface ReplaySegment {
  key: string;
  url: string;
  bytes: number;
}

interface ReplayPage {
  replayId: string;
  available: boolean;
  expiresAt: string | null;
  segments: ReplaySegment[];
  nextCursor: string | null;
  hasMore: boolean;
}

let testServer: TestApp;

function replayEventPayload(replayId: string, segmentId = 3) {
  return {
    type: "replay_event",
    replay_id: replayId,
    segment_id: segmentId,
    replay_type: "session",
    urls: ["https://example.com/checkout"],
    error_ids: [],
    trace_ids: [],
    timestamp: START_MS / 1000,
  };
}

// A realistic rrweb batch (session meta, full snapshot, incremental). The
// millisecond timestamps are what the offload key is ordered by.
function replayRecording(startMs = START_MS, label = "checkout") {
  return [
    {
      type: 4,
      timestamp: startMs,
      delay: 0,
      data: { href: "https://example.com/checkout", width: 1280, height: 720 },
    },
    {
      type: 2,
      timestamp: startMs + 1,
      delay: 1,
      data: { node: { type: 0, id: 1, childNodes: [] } },
    },
    {
      type: 3,
      timestamp: startMs + 2,
      delay: 2,
      data: { source: 0, texts: label },
    },
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
  return await appFetch(`${testServer.baseUrl}/api${dsn.pathname}/envelope/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_key=${encodeURIComponent(dsn.username)}, sentry_version=7`,
    },
    body: envelope,
  });
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await appFetch(`${testServer.baseUrl}${path}`, {
    headers: { Authorization: ADMIN_TOKEN },
  });
  return (await response.json()) as T;
}

function objectKeyFor(options: {
  replayKey: string;
  eventId: string;
  index: number;
  startedAtMs?: number;
}): string {
  const startedAt = String(options.startedAtMs ?? START_MS).padStart(16, "0");
  return `replays/${testServer.projectId}/${testServer.appId}/${options.replayKey}/${startedAt}-${options.eventId}-${options.index}.json`;
}

function replayQuery(eventId: string, replayId: string, query = ""): string {
  return `${testServer.baseUrl}/api/admin/events/${eventId}/replay/${replayId}${query}`;
}

function replayRequest(
  eventId: string,
  replayId: string,
  query = "",
): Promise<Response> {
  return appFetch(replayQuery(eventId, replayId, query), {
    headers: { Authorization: ADMIN_TOKEN },
  });
}

// Ingestion is asynchronous (NATS -> ClickHouse): the event must exist
// before the replay endpoint can resolve its project/app scope.
async function waitForReplay(
  eventId: string,
  replayId: string,
  query = "",
  timeoutMs = 15000,
): Promise<ReplayPage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await replayRequest(eventId, replayId, query);
    if (response.ok) return (await response.json()) as ReplayPage;
    await Bun.sleep(100);
  }
  throw new Error(`replay for event ${eventId} never became available`);
}

beforeAll(async () => {
  testServer = await startTestApp();
});

describe("Replay segment offload to the S3-compatible object store", () => {
  it("uploads recording segments, stores a pointer row and presigns the read path", async () => {
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

    // The segment landed in the object store, keyed by app + replay id and
    // prefixed with the segment start so listing is playback order.
    const key = objectKeyFor({ replayKey: replayId, eventId, index: 1 });
    const uploaded = await s3.file(key).text();
    expect(JSON.parse(uploaded)).toEqual(recording);

    // The stored row keeps the metadata inline and just the object key
    // instead of the segment.
    const stored = await waitForStoredEvent(eventId);
    const storedItems = JSON.parse(stored.envelopeItems) as Array<{
      header: { type: string };
      payload: unknown;
    }>;
    expect(storedItems.find((item) => item.header.type === "replay_event")!.payload).toEqual(
      replayEvent,
    );
    expect(
      storedItems.find((item) => item.header.type === "replay_recording")!.payload,
    ).toEqual({ key });

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

    // The replay read path returns a presigned URL for the segment, in
    // playback order, and the bytes come straight from the object store.
    const page = await waitForReplay(eventId, replayId);
    expect(page.replayId).toBe(replayId);
    expect(page.available).toBe(true);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.segments).toHaveLength(1);
    expect(page.segments[0]!.key).toBe(key);
    expect(page.segments[0]!.bytes).toBeGreaterThan(0);

    const objectResponse = await fetch(page.segments[0]!.url);
    expect(objectResponse.status).toBe(200);
    expect(await objectResponse.json()).toEqual(recording);
  }, 30000);

  it("keys the segment by the error event's contexts.replay id", async () => {
    const eventId = crypto.randomUUID();
    const replayId = "8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b";
    const recording = replayRecording();

    // The envelope carries the error event, not a replay_event item: the
    // session id comes from the error event's contexts.replay.
    const response = await sendEnvelope(
      buildEnvelope({ event_id: eventId, sent_at: new Date().toISOString() }, [
        {
          header: { type: "event", content_type: "application/json" },
          payload: {
            event_id: eventId,
            level: "error",
            message: "checkout exploded",
            contexts: { replay: { replay_id: replayId } },
          },
        },
        {
          header: { type: "replay_recording", content_type: "application/json" },
          payload: recording,
        },
      ]),
    );
    expect(response.status).toBe(200);

    const key = objectKeyFor({ replayKey: replayId, eventId, index: 1 });
    expect(JSON.parse(await s3.file(key).text())).toEqual(recording);

    // The issue page asks for the replay id the error event carries.
    const page = await waitForReplay(eventId, replayId);
    expect(page.available).toBe(true);
    expect(page.segments).toHaveLength(1);
    expect(page.segments[0]!.key).toBe(key);
  }, 30000);

  it("falls back to the message id when the envelope carries no replay metadata", async () => {
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
    expect(JSON.parse(await s3.file(key).text())).toEqual(recording);

    await waitForStoredEvent(eventId);
    const detail = await apiGet<{ key: string }>(`/events/${eventId}`);
    expect(detail.key).toBe(key);
  }, 30000);

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

    const stored = await waitForStoredEvent(eventId);
    const storedItems = JSON.parse(stored.envelopeItems) as Array<{
      header: { type: string };
      payload: unknown;
    }>;
    expect(storedItems[0]!.payload).toEqual(event);

    const detail = await apiGet<Record<string, unknown>>(`/events/${eventId}`);
    expect(detail.message).toBe(event.message);
  }, 30000);

  it("pages segment URLs in playback order, independent of message id order", async () => {
    const replayId = "ordered-replay-0000";
    // The later segment's message id sorts before the earlier one, so key
    // order is only correct because the key embeds the segment start.
    // Random ids keep the test independent of ClickHouse rows from earlier
    // runs (events are fetched by id).
    const [lateId, earlyId] = [crypto.randomUUID(), crypto.randomUUID()].sort() as [
      string,
      string,
    ];
    const earlyStart = START_MS;
    const lateStart = START_MS + 30_000;

    const sendRecording = (messageId: string, startMs: number, label: string) =>
      sendEnvelope(
        buildEnvelope({ event_id: messageId, sent_at: new Date().toISOString() }, [
          { header: { type: "replay_event", content_type: "application/json" }, payload: replayEventPayload(replayId) },
          {
            header: { type: "replay_recording", content_type: "application/json" },
            payload: replayRecording(startMs, label),
          },
        ]),
      );

    expect((await sendRecording(earlyId, earlyStart, "checkout")).status).toBe(200);
    expect((await sendRecording(lateId, lateStart, "thank-you")).status).toBe(200);

    const first = await waitForReplay(earlyId, replayId, "?limit=1");
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0]!.key).toContain(earlyId);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(first.segments[0]!.key);

    const secondResponse = await replayRequest(
      earlyId,
      replayId,
      `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as ReplayPage;
    expect(second.segments).toHaveLength(1);
    expect(second.segments[0]!.key).toContain(lateId);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    // The presigned URLs carry the segments in the same order.
    const earlyEvents = (await (await fetch(first.segments[0]!.url)).json()) as Array<{
      data?: { texts?: string };
    }>;
    const lateEvents = (await (await fetch(second.segments[0]!.url)).json()) as Array<{
      data?: { texts?: string };
    }>;
    expect(earlyEvents[2]!.data?.texts).toBe("checkout");
    expect(lateEvents[2]!.data?.texts).toBe("thank-you");

    // A cursor outside this replay's prefix is rejected.
    const invalid = await replayRequest(earlyId, replayId, "?cursor=replays/other");
    expect(invalid.status).toBe(400);
  }, 30000);

  it("keeps recording payloads inline when the object store write fails", async () => {
    const originalWrite = s3.write;
    (s3 as unknown as { write: typeof s3.write }).write = (() =>
      Promise.reject(new Error("object store unavailable"))) as typeof s3.write;
    try {
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

      const stored = await waitForStoredEvent(eventId);
      const storedItems = JSON.parse(stored.envelopeItems) as Array<{
        header: { type: string };
        payload: unknown;
      }>;
      expect(storedItems[0]!.payload).toEqual(recording);

      const detail = await apiGet<unknown>(`/events/${eventId}`);
      expect(detail).toEqual(recording);
    } finally {
      (s3 as unknown as { write: typeof s3.write }).write = originalWrite;
    }
  }, 30000);
});
