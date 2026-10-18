import { Elysia } from "elysia";
import { type } from "arktype";
import { requireReadAccess, scopedViewFor } from "../permissions.ts";
import { notFound } from "../errors.ts";
import { findStoredEventByIdOrThrow } from "../events-store.ts";
import { parseStoredEnvelope } from "../events/utils.ts";
import { replayObjectPrefix } from "../events/offload.ts";
import { getObjectText, listObjectKeys } from "../storage.ts";

function adminAuthEnforced() { return !!process.env.ADMIN_TOKEN || !!process.env.OIDC_ISSUER || !!process.env.OAUTH_ISSUER || process.env.NODE_ENV === "production"; }

const MAX_SEGMENTS = 500;
const MAX_BYTES = 10 * 1024 * 1024;

interface LoadedSegment {
  key: string;
  bytes: number;
  events: unknown[];
  startedAt: number | null;
}

function emptyReplay(replayId: string | null) {
  return {
    replayId,
    available: true,
    truncated: false,
    bytes: 0,
    segments: [] as Array<{ key: string; events: number; bytes: number; startedAt: string | null }>,
    events: [] as unknown[],
  };
}

function segmentStart(events: unknown[]): number | null {
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const timestamp = (event as Record<string, unknown>).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

export const replayRoutes = new Elysia({ prefix: "replays" })
  .onBeforeHandle(async ({ request }) => {
    if (!adminAuthEnforced()) return;
    await requireReadAccess(request);
  })
  .get(
    "/by-event/:eventId",
    async ({ params: { eventId }, request }) => {
      const stored = await findStoredEventByIdOrThrow(eventId);

      const view = await scopedViewFor(request);
      if (view && !view.appIds.has(stored.appId ?? "")) {
        throw notFound("Event", eventId);
      }

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
        console.error(`[replays] Listing "${prefix}" failed:`, err);
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
          console.error(`[replays] Reading "${key}" failed:`, err);
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
        if (a.startedAt != null && b.startedAt != null && a.startedAt !== b.startedAt) {
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
          startedAt: segment.startedAt != null ? new Date(segment.startedAt).toISOString() : null,
        })),
        events: loaded.flatMap((segment) => segment.events),
      };
    },
    { params: type({ eventId: "string" }) },
  );