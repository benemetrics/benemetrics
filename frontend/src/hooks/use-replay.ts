import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Session replay read path (docs/session-replays.md §5): pages of presigned
// segment URLs from GET /api/admin/events/:eventId/replay/:replayId; the
// browser fetches the bytes directly — the backend never proxies payloads.

type ReplayPage = {
  replayId: string;
  available: boolean;
  segments: Array<{ key: string; url: string; bytes: number }>;
  nextCursor: string | null;
  hasMore: boolean;
};

// rrweb events stay untyped here — the player receives them as sent.
export type RrwebEvent = Record<string, unknown>;

export type ReplayState = "idle" | "loading" | "ready" | "missing" | "error";

/** The error event's `contexts.replay.replay_id` — a replay link on the event. */
export function replayIdFromPayload(
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload) return null;
  const contexts = payload["contexts"] as Record<string, unknown> | undefined;
  const replay = contexts?.["replay"] as Record<string, unknown> | undefined;
  const id = replay?.["replay_id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Loads the full session: walks `nextCursor`, then each presigned URL.
 * The plain `fetch(seg.url)` carries no auth header on purpose — it would
 * break the presigned S3 signature. */
export function useReplay(
  eventId: string | undefined,
  replayId: string | null,
  open: boolean,
) {
  const [events, setEvents] = useState<RrwebEvent[] | null>(null);
  const [state, setState] = useState<ReplayState>("idle");

  useEffect(() => {
    if (!open || !eventId || !replayId) return;
    let alive = true;
    setState("loading");
    setEvents(null);

    (async () => {
      try {
        const segments: ReplayPage["segments"] = [];
        let cursor: string | undefined;
        // page cap guards a pathological cursor chain; endpoint max is 50/page
        for (let page = 0; page < 200; page += 1) {
          const res: { error?: unknown; status?: number; data?: ReplayPage } =
            await api["events"][eventId]["replay"][replayId].get({
              query: {
                ...(cursor ? { cursor } : {}),
                limit: 50,
              },
            });
          if (!alive) return;
          if (res.error || !res.data)
            throw new Error(
              `replay list failed${res.status ? ` (${res.status})` : ""}`,
            );
          if (!res.data.available) {
            setState("missing");
            return;
          }
          segments.push(...res.data.segments);
          if (!res.data.hasMore || !res.data.nextCursor) break;
          cursor = res.data.nextCursor;
        }

        const rrweb: RrwebEvent[] = [];
        for (const seg of segments) {
          const res = await fetch(seg.url);
          if (!res.ok)
            throw new Error(`segment fetch failed (${res.status})`);
          const payload = (await res.json()) as unknown;
          if (Array.isArray(payload)) rrweb.push(...(payload as RrwebEvent[]));
        }
        if (!alive) return;
        setEvents(rrweb);
        setState(rrweb.length > 0 ? "ready" : "missing");
      } catch {
        if (alive) setState("error");
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, eventId, replayId]);

  return { events, state };
}
