/**
 * E2E Test: Session replay for an issue.
 *
 * The issue details page (/ui/issues/:eventId) carries a "Session replay"
 * section next to the event details. The error event links the recording
 * that was running around it (`contexts.replay.replay_id`); the backend
 * returns pages of presigned object-store URLs for that session and the
 * browser streams the segments straight into rrweb.
 *
 * The suite runs against the compose RustFS (`docker compose up -d rustfs
 * rustfs-init`, bucket `sentry-replays`); the bucket's CORS rule allows the
 * UI origin to fetch the presigned GETs. The API is asserted directly for
 * ordering, pagination, absent replays and unknown events; a real Chrome
 * session asserts the section on the page.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startTestServer, type TestServer } from "./test-helpers";

const ADMIN_TOKEN = "API-Key e2e-admin-token";
const REPLAY_ID = "4f9a4f9a4f9a4f9a4f9a4f9a4f9a4f9a";
// The later segment's message id sorts before the earlier one; only the
// start-time prefix in the object key keeps playback order correct.
const EARLY_SEGMENT_ID = "ffffffff-1111-4111-8111-111111111111";
const LATE_SEGMENT_ID = "00000000-2222-4222-8222-222222222222";
const EARLY_START_MS = 1_700_000_000_000;
const LATE_START_MS = 1_700_000_030_000;

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

let testServer: TestServer;
let view: Bun.WebView;
let errorEventId = "";
let plainEventId = "";

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

function replayRequest(
  eventId: string,
  replayId: string,
  query = "",
): Promise<Response> {
  return fetch(
    `${testServer.baseUrl}/api/admin/events/${eventId}/replay/${replayId}${query}`,
    { headers: { Authorization: ADMIN_TOKEN } },
  );
}

// Ingestion is asynchronous (NATS -> ClickHouse): the replay endpoint
// needs the stored event for its project/app scope, so poll instead of
// racing.
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
// each carrying the millisecond timestamp the object key is ordered by.
function replayRecording(
  href: string,
  timestamp: number,
  label: string,
): Array<Record<string, unknown>> {
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
  recording: Array<Record<string, unknown>>,
  timestampSeconds: number,
): Promise<void> {
  const response = await sendEnvelope(
    buildEnvelope({ event_id: messageId, sent_at: new Date().toISOString() }, [
      {
        header: { type: "replay_event", content_type: "application/json" },
        payload: replayMeta(replayId, segmentId, timestampSeconds),
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
      EARLY_START_MS / 1000,
    );
    await sendRecording(
      LATE_SEGMENT_ID,
      REPLAY_ID,
      1,
      replayRecording("https://example.com/thank-you", LATE_START_MS, "thank-you"),
      LATE_START_MS / 1000,
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
  });

  it("returns presigned segment URLs in playback order", async () => {
    const replay = await waitForReplay(errorEventId, REPLAY_ID);

    expect(replay.replayId).toBe(REPLAY_ID);
    expect(replay.available).toBe(true);
    expect(replay.hasMore).toBe(false);
    expect(replay.nextCursor).toBeNull();
    expect(replay.expiresAt).toBeTruthy();
    expect(replay.segments).toHaveLength(2);
    expect(replay.segments[0]!.bytes).toBeGreaterThan(0);

    // Playback order follows the start-time prefix, not the message id.
    expect(replay.segments[0]!.key).toContain(EARLY_SEGMENT_ID);
    expect(replay.segments[1]!.key).toContain(LATE_SEGMENT_ID);

    const early = (await (await fetch(replay.segments[0]!.url)).json()) as Array<{
      timestamp: number;
      data?: { href?: string };
    }>;
    const late = (await (await fetch(replay.segments[1]!.url)).json()) as Array<{
      data?: { texts?: string };
    }>;
    expect(early[0]!.timestamp).toBe(EARLY_START_MS);
    expect(early[0]!.data?.href).toBe("https://example.com/checkout");
    expect(late[2]!.data?.texts).toBe("thank-you");
  }, 30000);

  it("pages segments with the cursor (limit=1)", async () => {
    const first = await waitForReplay(errorEventId, REPLAY_ID, "?limit=1");
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0]!.key).toContain(EARLY_SEGMENT_ID);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(first.segments[0]!.key);

    const secondResponse = await replayRequest(
      errorEventId,
      REPLAY_ID,
      `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as ReplayPage;
    expect(second.segments).toHaveLength(1);
    expect(second.segments[0]!.key).toContain(LATE_SEGMENT_ID);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    const invalid = await replayRequest(errorEventId, REPLAY_ID, "?cursor=replays/other");
    expect(invalid.status).toBe(400);
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

    const replay = await waitForReplay(eventId, replayId);
    expect(replay.replayId).toBe(replayId);
    expect(replay.available).toBe(true);
    expect(replay.segments).toEqual([]);
    expect(replay.hasMore).toBe(false);
  }, 30000);

  it("leaves events without a replay link unlinked", async () => {
    const detail = await apiGet<{ replay_id?: string }>(`/events/${plainEventId}`);
    expect(detail.replay_id).toBeUndefined();
  }, 30000);

  it("404s for unknown events", async () => {
    const response = await replayRequest(crypto.randomUUID(), REPLAY_ID);
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
