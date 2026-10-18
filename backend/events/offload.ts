import { putObject } from "../storage.ts";
import { parseEnvelope, type ParsedEnvelope } from "./utils.ts";

export interface OffloadedItemPayload {
  key: string;
}

const OFFLOADED_ITEM_TYPES = new Set(["replay_recording"]);
const UPLOAD_TIMEOUT_MS = 5000;

function sanitizeKeyPart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  return sanitized.length > 0 ? sanitized : "_";
}

export function replayObjectPrefix(context: { projectId: string; appId: string; replayId: string }): string {
  return `replays/${sanitizeKeyPart(context.projectId)}/${sanitizeKeyPart(context.appId)}/${sanitizeKeyPart(context.replayId)}/`;
}

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

async function putObjectBounded(key: string, body: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      putObject(key, body),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`upload timed out after ${UPLOAD_TIMEOUT_MS}ms`)), UPLOAD_TIMEOUT_MS);
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

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
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
      console.error(`[storage] Keeping "${key}" inline after write failure:`, err);
      result.push(item);
    }
  }

  return result;
}