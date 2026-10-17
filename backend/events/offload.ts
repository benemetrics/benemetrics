import { putObject } from "../storage";
import type { ParsedEnvelope } from "./utils";

// Replay recording segments are rrweb batches that can reach hundreds of
// kilobytes each; stored inline they would be duplicated in the row's
// `envelope_items` and `raw` columns (and again in the ClickHouse copy)
// and re-parsed on every events list/alerting sweep. At ingestion the
// recordings are moved to the object store — S3 when `S3_BUCKET` is
// configured, the local `LOCAL_STORAGE_DIR` directory otherwise — and
// the item keeps just the object key. The backend is not recorded: reads
// resolve the key against the storage configuration active at read time.
// The offload is best-effort: when the write fails or stalls the payload
// stays inline and ingestion is never affected.

// A recording payload that lives in the object store. Shape check for
// readers: the recording item payload is an rrweb array when inline and
// an object carrying `key` when offloaded.
export interface OffloadedItemPayload {
  /** Object key below the bucket / local storage directory. */
  key: string;
}

const OFFLOADED_ITEM_TYPES = new Set(["replay_recording"]);

// Bounds a single upload so a hung object store cannot stall ingestion;
// on timeout the payload is kept inline.
const UPLOAD_TIMEOUT_MS = 5000;

// Object keys embed client-controlled ids, so bound both the accepted
// characters and the length (S3 keys may not exceed 1024 bytes). Dots are
// excluded so a key part can never be `.`/`..` and climb out of its
// directory (the local backend also re-checks the resolved path).
function sanitizeKeyPart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return sanitized.length > 0 ? sanitized : "_";
}

// The prefix a session's segments live under. Shared with the read path
// (`backend/replays`) so both derive the same location from the ids they
// hold, without the storage backend or pointers being recorded anywhere.
export function replayObjectPrefix(context: {
  projectId: string;
  appId: string;
  replayId: string;
}): string {
  return `replays/${sanitizeKeyPart(context.projectId)}/${sanitizeKeyPart(context.appId)}/${sanitizeKeyPart(context.replayId)}/`;
}

// Groups a session's segments under its replay id when the envelope
// carries replay metadata, falling back to the message id otherwise.
function replayKeyFor(items: ParsedEnvelope["items"], fallback: string): string {
  for (const item of items) {
    if (item.header.type !== "replay_event") continue;
    if (item.payload && typeof item.payload === "object") {
      const replayId = (item.payload as Record<string, unknown>).replay_id;
      if (typeof replayId === "string" && replayId.length > 0) {
        return sanitizeKeyPart(replayId);
      }
    }
  }
  return sanitizeKeyPart(fallback);
}

async function putObjectBounded(
  key: string,
  body: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      putObject(key, body),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`upload timed out after ${UPLOAD_TIMEOUT_MS}ms`)),
          UPLOAD_TIMEOUT_MS,
        );
      }),
    ]);
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

  const result: ParsedEnvelope["items"] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (!OFFLOADED_ITEM_TYPES.has(item.header.type)) {
      result.push(item);
      continue;
    }

    const serialized = JSON.stringify(item.payload);
    const key = `${prefix}${messageId}-${index}.json`;
    try {
      await putObjectBounded(key, serialized);
      const pointer: OffloadedItemPayload = { key };
      result.push({ header: item.header, payload: pointer });
    } catch (err) {
      console.error(
        `[storage] Keeping "${key}" inline after write failure:`,
        err instanceof Error ? err.message : String(err),
      );
      result.push(item);
    }
  }

  return result;
}
