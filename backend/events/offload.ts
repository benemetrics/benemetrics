import { s3 } from "../storage";
import type { ParsedEnvelope } from "./utils";

export interface OffloadedItemPayload {
  key: string;
}

const OFFLOADED_ITEM_TYPES = new Set(["replay_recording"]);

const UPLOAD_TIMEOUT_MS = 5000;

function sanitizeKeyPart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return sanitized.length > 0 ? sanitized : "_";
}

export function replayObjectPrefix(context: {
  projectId: string;
  appId: string;
  replayId: string;
}): string {
  return `replays/${sanitizeKeyPart(context.projectId)}/${sanitizeKeyPart(context.appId)}/${sanitizeKeyPart(context.replayId)}/`;
}

function replayIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const replayId = (payload as Record<string, unknown>).replay_id;
  return typeof replayId === "string" && replayId.length > 0 ? replayId : null;
}

function contextsReplayId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const contexts = (payload as Record<string, unknown>).contexts;
  if (!contexts || typeof contexts !== "object") return null;
  const replay = (contexts as Record<string, unknown>).replay;
  if (!replay || typeof replay !== "object") return null;
  return replayIdOf(replay);
}

// The replay session is identified by the `replay_event` metadata or, when
// the envelope carries the error event itself, by its `contexts.replay`.
function replayKeyFor(
  items: ParsedEnvelope["items"],
  fallback: string,
): string {
  for (const item of items) {
    if (item.header.type !== "replay_event") continue;
    const replayId = replayIdOf(item.payload);
    if (replayId) return sanitizeKeyPart(replayId);
  }
  for (const item of items) {
    if (item.header.type !== "event") continue;
    const replayId = contextsReplayId(item.payload);
    if (replayId) return sanitizeKeyPart(replayId);
  }
  return sanitizeKeyPart(fallback);
}

// The segment's earliest rrweb timestamp, zero-padded into the object key
// so lexical key order is playback order (and the replay read path can
// paginate with a `startAfter` cursor without reading any object).
function segmentStartMs(payload: unknown): number {
  if (Array.isArray(payload)) {
    let earliest: number | null = null;
    for (const event of payload) {
      if (!event || typeof event !== "object") continue;
      const timestamp = (event as Record<string, unknown>).timestamp;
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        if (earliest === null || timestamp < earliest) earliest = timestamp;
      }
    }
    if (earliest !== null) return earliest;
  }
  return Date.now();
}

async function putObjectBounded(key: string, body: string): Promise<void> {
  const write = s3.write(key, body, { type: "application/json" });
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      write,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abandoned = true;
          reject(new Error(`upload timed out after ${UPLOAD_TIMEOUT_MS}ms`));
        }, UPLOAD_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    // The write may still land after the timeout; remove it so the bucket
    // keeps no orphan.
    if (abandoned) {
      void write.then(() => s3.delete(key)).catch(() => {});
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function offloadReplayItems(
  items: ParsedEnvelope["items"],
  context: { projectId: string; appId: string; messageId: string },
): Promise<ParsedEnvelope["items"]> {
  const messageId = sanitizeKeyPart(context.messageId);
  const prefix = replayObjectPrefix({
    projectId: context.projectId,
    appId: context.appId,
    replayId: replayKeyFor(items, messageId),
  });

  return Promise.all(
    items.map(async (item, index): Promise<ParsedEnvelope["items"][number]> => {
      if (!OFFLOADED_ITEM_TYPES.has(item.header.type)) return item;

      const serialized = JSON.stringify(item.payload);
      const key = `${prefix}${String(segmentStartMs(item.payload)).padStart(16, "0")}-${messageId}-${index}.json`;
      try {
        await putObjectBounded(key, serialized);
        const pointer: OffloadedItemPayload = { key };
        return { header: item.header, payload: pointer };
      } catch (err) {
        console.error(
          `[storage] Keeping "${key}" inline after write failure:`,
          err instanceof Error ? err.message : String(err),
        );
        return item;
      }
    }),
  );
}
