import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { adminAuthEnforced, validateAdminAuth } from "../auth";
import { unauthorized } from "../errors";
import { findStoredEventByIdOrThrow } from "../events-store";
import { parseStoredEnvelope, type ParsedEnvelope } from "../events/utils";
import { replayObjectPrefix } from "../events/offload";
import { getObjectText, listObjectKeys } from "../storage";

// Reads the recording of the session an issue was reported in. The replay
// is linked from the event itself — `contexts.replay.replay_id` on error
// events, `replay_id` on replay metadata items — and its segments are
// located through the same object-key prefix ingestion writes them to, so
// Postgres keeps no replay index. Storage failures degrade to an empty
// segment list instead of failing the request; the session payload is
// never allowed to break the issue page.

// Bounds one read so a large or misbehaving session cannot exhaust the
// server or ship an unbounded body to the player.
const MAX_SEGMENTS = 500;
const MAX_BYTES = 10 * 1024 * 1024;

interface LoadedSegment {
  key: string;
  bytes: number;
  events: unknown[];
  startedAt: number | null;
}

// Replay linkage sources, in order of authority: replay metadata items
// carry `replay_id`, and error events captured while a replay is running
// carry it in `contexts.replay` (which is what ties the issue to the
// session).
function replayIdFromEnvelope(items: ParsedEnvelope["items"]): string | null {
  for (const item of items) {
    const payload = item.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const record = payload as Record<string, unknown>;

    if (item.header.type === "replay_event") {
      const replayId = record.replay_id;
      if (typeof replayId === "string" && replayId.length > 0) return replayId;
    }

    const contexts = record.contexts;
    if (!contexts || typeof contexts !== "object" || Array.isArray(contexts)) {
      continue;
    }
    const replay = (contexts as Record<string, unknown>).replay;
    if (!replay || typeof replay !== "object" || Array.isArray(replay)) {
      continue;
    }
    const replayId = (replay as Record<string, unknown>).replay_id;
    if (typeof replayId === "string" && replayId.length > 0) return replayId;
  }
  return null;
}

// rrweb events carry millisecond timestamps; the earliest one anchors a
// segment in the session. Object keys embed random message ids, so key
// order says nothing about playback order.
function segmentStart(events: unknown[]): number | null {
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const timestamp = (event as Record<string, unknown>).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function emptyReplay(replayId: string | null) {
  return {
    replayId,
    available: true,
    truncated: false,
    bytes: 0,
    segments: [] as Array<{
      key: string;
      events: number;
      bytes: number;
      startedAt: string | null;
    }>,
    events: [] as unknown[],
  };
}

export const replayRoutes = new Elysia({ prefix: "replays" })
  // The UI surface is open while running locally without an identity
  // provider; it requires admin credentials in production or once
  // ADMIN_TOKEN / OIDC / OAuth is configured.
  .onBeforeHandle(({ request }) => {
    if (!adminAuthEnforced()) return;
    const auth = validateAdminAuth(request);
    if (!auth.valid) {
      throw unauthorized(auth.error);
    }
  })
  .get(
    "/by-event/:eventId",
    async ({ params: { eventId } }) => {
      const stored = await findStoredEventByIdOrThrow(eventId);
      const parsed = parseStoredEnvelope(stored);
      const replayId = parsed ? replayIdFromEnvelope(parsed.items) : null;
      if (!replayId) return emptyReplay(null);

      const prefix = replayObjectPrefix({
        projectId: stored.projectId,
        appId: stored.appId ?? "",
        replayId,
      });

      let keys: string[];
      try {
        keys = await listObjectKeys(prefix, MAX_SEGMENTS);
      } catch (err) {
        console.error(
          `[replays] Listing "${prefix}" failed:`,
          err instanceof Error ? err.message : String(err),
        );
        return { ...emptyReplay(replayId), available: false };
      }

      const loaded: LoadedSegment[] = [];
      let bytes = 0;
      let truncated = false;
      for (const key of keys) {
        if (loaded.length >= MAX_SEGMENTS || bytes >= MAX_BYTES) {
          truncated = true;
          break;
        }
        let text: string | null;
        try {
          text = await getObjectText(key);
        } catch (err) {
          console.error(
            `[replays] Reading "${key}" failed:`,
            err instanceof Error ? err.message : String(err),
          );
          continue;
        }
        if (text == null || text.length > MAX_BYTES) continue;

        let events: unknown;
        try {
          events = JSON.parse(text);
        } catch {
          continue;
        }
        if (!Array.isArray(events)) continue;

        loaded.push({
          key,
          bytes: text.length,
          events,
          startedAt: segmentStart(events),
        });
        bytes += text.length;
      }

      loaded.sort((a, b) => {
        if (
          a.startedAt != null &&
          b.startedAt != null &&
          a.startedAt !== b.startedAt
        ) {
          return a.startedAt - b.startedAt;
        }
        return a.key.localeCompare(b.key);
      });

      return {
        replayId,
        available: true,
        truncated,
        bytes,
        segments: loaded.map((segment) => ({
          key: segment.key,
          events: segment.events.length,
          bytes: segment.bytes,
          startedAt:
            segment.startedAt != null
              ? new Date(segment.startedAt).toISOString()
              : null,
        })),
        events: loaded.flatMap((segment) => segment.events),
      };
    },
    { params: arktype({ eventId: "string" }) },
  );
