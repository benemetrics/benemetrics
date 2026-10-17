/**
 * E2E Test: Session replay for an issue.
 *
 * The issue details page (/ui/issues/:eventId) carries a "Session replay"
 * section next to the event details. The backend links the error to the
 * recording that was running around it (replay metadata items, or
 * `contexts.replay` on the error event) and reads the segments back from
 * object storage, assembled in playback order. Events without a replay
 * keep the section visible with an explicit empty state.
 *
 * Uses the local storage backend (LOCAL_STORAGE_DIR) so segments are
 * written and read in-process; the S3 write path is covered by
 * 28-replay-offload.test.ts. The API is asserted directly for ordering,
 * absent replays and unknown events; a real Chrome session asserts the
 * section on the page.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer, type TestServer } from "./test-helpers";

const ADMIN_TOKEN = "Bearer e2e-admin-token";
const REPLAY_ID = "4f9a4f9a4f9a4f9a4f9a4f9a4f9a4f9a";
// The later segment's message id sorts before the earlier one, so
// assembling by object key order alone would play the session backwards.
const EARLY_SEGMENT_ID = "ffffffff-1111-4111-8111-111111111111";
const LATE_SEGMENT_ID = "00000000-2222-4222-8222-222222222222";
const EARLY_START_MS = 1_700_000_000_000;
const LATE_START_MS = 1_700_000_030_000;

interface ReplaySegment {
  key: string;
  events: number;
  bytes: number;
  startedAt: string | null;
}

interface ReplayPayload {
  replayId: string | null;
  available: boolean;
  truncated: boolean;
  bytes: number;
  segments: ReplaySegment[];
  events: Array<Record<string, unknown>>;
}

let testServer: TestServer;
let storageDir = "";
let view: Bun.WebView;
let errorEventId = "";
let plainEventId = "";

// Snapshot the outer environment so the file leaves no storage env behind.
const ORIGINAL_ENV = {
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_SESSION_TOKEN: process.env.S3_SESSION_TOKEN,
  LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
};

function restoreStorageEnv(): void {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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

function replayMeta(replayId: string, segmentId: number, timestamp: number) {
  return {
    type: "replay_event",
    replay_id: replayId,
    segment_id: segmentId,
    replay_type: "session",
    urls: ["https://example.com/checkout"],
    error_ids: [],
    trace_ids: [],
    timestamp,
  };
}

// A realistic rrweb batch: session meta, a full snapshot and incrementals,
// each carrying the millisecond timestamp playback order is derived from.
function replayRecording(href: string, timestamp: number, label: string) {
  return [
    { type: 4, data: { href, width: 1280, height: 720 }, timestamp, delay: 0 },
    {
      type: 2,
      data: {
        node: {
          type: 0,
          id: 1,
          childNodes: [
            {
              type: 2,
              id: 2,
              tagName: "html",
              attributes: {},
              childNodes: [
                {
                  type: 2,
                  id: 3,
                  tagName: "body",
                  attributes: {},
                  childNodes: [{ type: 3, id: 4, textContent: label, isStyle: false }],
                },
              ],
            },
          ],
        },
        initialOffset: { top: 0, left: 0 },
      },
      timestamp: timestamp + 1,
      delay: 1,
    },
    { type: 3, data: { source: 0, texts: label }, timestamp: timestamp + 2, delay: 2 },
  ];
}

function eventPayload(
  eventId: string,
  message: string,
  contexts?: Record<string, unknown>,
) {
  return {
    event_id: eventId,
    level: "error",
    message,
    platform: "javascript",
    timestamp: 1700000000.5,
    ...(contexts ? { contexts } : {}),
    exception: { values: [{ type: "TypeError", value: "Cannot read 'id' of null" }] },
  };
}

async function sendEvent(eventId: string, payload: Record<string, unknown>): Promise<void> {
  const response = await sendEnvelope(
    buildEnvelope({ event_id: eventId, sent_at: new Date().toISOString() }, [
      { header: { type: "event", content_type: "application/json" }, payload },
    ]),
  );
  expect(response.status).toBe(200);
}

async function sendRecording(
  messageId: string,
  replayId: string,
  segmentId: number,
  recording: unknown[],
): Promise<void> {
  const response = await sendEnvelope(
    buildEnvelope({ event_id: messageId, sent_at: new Date().toISOString() }, [
      {
        header: { type: "replay_event", content_type: "application/json" },
        payload: replayMeta(replayId, segmentId, recording[0] && ((recording[0] as any).timestamp ?? 0) / 1000),
      },
      {
        header: { type: "replay_recording", content_type: "application/json" },
        payload: recording,
      },
    ]),
  );
  expect(response.status).toBe(200);
}

async function waitForTextInUI(text: string, timeoutMs = 15000): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body.innerText")) ?? "";
    if (body.includes(text)) return body;
    await Bun.sleep(400);
  }
  const shot = await view.screenshot();
  await Bun.write("/tmp/e2e-replay-issue-failure.png", shot);
  throw new Error(
    `"${text}" not found in the UI within ${timeoutMs}ms. Page text: ${body.slice(0, 300)}`,
  );
}

async function waitForSelector(selector: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found =
      (await view.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) ?? false;
    if (found) return true;
    await Bun.sleep(400);
  }
  return false;
}

describe("Session replay on the issue details page", () => {
  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "e2e-replay-issue-"));
    delete process.env.S3_BUCKET;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_SESSION_TOKEN;
    process.env.LOCAL_STORAGE_DIR = storageDir;

    testServer = await startTestServer();

    // The error event carries the replay link the SDK attaches while a
    // session is being recorded.
    errorEventId = crypto.randomUUID();
    await sendEvent(
      errorEventId,
      eventPayload(errorEventId, `Checkout crashed ${errorEventId}`, {
        replay: { replay_id: REPLAY_ID, segment_id: 1 },
      }),
    );

    await sendRecording(
      EARLY_SEGMENT_ID,
      REPLAY_ID,
      0,
      replayRecording("https://example.com/checkout", EARLY_START_MS, "checkout"),
    );
    await sendRecording(
      LATE_SEGMENT_ID,
      REPLAY_ID,
      1,
      replayRecording("https://example.com/thank-you", LATE_START_MS, "thank-you"),
    );

    // An occurrence without any replay link, for the empty state.
    plainEventId = crypto.randomUUID();
    await sendEvent(plainEventId, eventPayload(plainEventId, `Plain error ${plainEventId}`));

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${testServer.baseUrl}/ui/overview`);
    await view.evaluate(`localStorage.setItem("benedebug.adminToken", "e2e-admin-token")`);
    await view.navigate(`${testServer.baseUrl}/ui/overview`);
  }, 30000);

  afterAll(async () => {
    await view?.close();
    testServer?.stop();
    restoreStorageEnv();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("assembles the linked replay's segments in playback order", async () => {
    const replay = await apiGet<ReplayPayload>(`/replays/by-event/${errorEventId}`);

    expect(replay.replayId).toBe(REPLAY_ID);
    expect(replay.available).toBe(true);
    expect(replay.truncated).toBe(false);
    expect(replay.bytes).toBeGreaterThan(0);
    expect(replay.segments).toHaveLength(2);
    expect(replay.events).toHaveLength(6);

    // Playback order follows the rrweb timestamps, not the sorted key
    // order (which would put the later segment first).
    expect(replay.segments[0]!.key).toContain(EARLY_SEGMENT_ID);
    expect(replay.segments[0]!.startedAt).toBe(new Date(EARLY_START_MS).toISOString());
    expect(replay.events[0]!.timestamp).toBe(EARLY_START_MS);
    expect((replay.events[0]!.data as { href?: string }).href).toBe(
      "https://example.com/checkout",
    );
    expect((replay.events[5]!.data as { texts?: string }).texts).toBe("thank-you");
  }, 30000);

  it("reports a linked replay with no stored segments as available and empty", async () => {
    const replayId = "empty-replay-0000";
    const eventId = crypto.randomUUID();
    await sendEvent(
      eventId,
      eventPayload(eventId, `Orphaned replay ${eventId}`, {
        replay: { replay_id: replayId },
      }),
    );

    const replay = await apiGet<ReplayPayload>(`/replays/by-event/${eventId}`);
    expect(replay.replayId).toBe(replayId);
    expect(replay.available).toBe(true);
    expect(replay.segments).toEqual([]);
    expect(replay.events).toEqual([]);
  }, 30000);

  it("reports no replay for events without a replay link", async () => {
    const replay = await apiGet<ReplayPayload>(`/replays/by-event/${plainEventId}`);
    expect(replay.replayId).toBeNull();
    expect(replay.available).toBe(true);
    expect(replay.segments).toEqual([]);
    expect(replay.events).toEqual([]);
  }, 30000);

  it("404s for unknown events", async () => {
    const response = await fetch(
      `${testServer.baseUrl}/replays/by-event/${crypto.randomUUID()}`,
      { headers: { Authorization: ADMIN_TOKEN } },
    );
    expect(response.status).toBe(404);
  }, 30000);

  it("renders the replay section with the player for a linked replay", async () => {
    await view.navigate(`${testServer.baseUrl}/ui/issues/${errorEventId}`);
    const body = await waitForTextInUI("Session replay");
    expect(body).toContain("2 segments");
    expect(body).toContain("6 events");
    expect(body).toContain(`replay ${REPLAY_ID.slice(0, 8)}`);

    // rrweb renders the replay into an iframe inside the stage.
    const rendered = await waitForSelector(".replay-stage .rr-player, .replay-stage iframe", 20000);
    expect(rendered).toBe(true);
  }, 40000);

  it("keeps the section with an empty state for events without a replay", async () => {
    await view.navigate(`${testServer.baseUrl}/ui/issues/${plainEventId}`);
    const body = await waitForTextInUI("Session replay");
    expect(body).toContain("No session replay is linked to this issue");
  }, 30000);
});
