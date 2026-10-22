import { badRequest, payloadTooLarge } from "backend/errors";
import { rateLimitConfig } from "./config";

/**
 * Request hygiene: the per-request cost is bounded, so a client that
 * spams cannot make the server do unbounded work.
 *
 * These are caps, not quotas — nothing here limits how much a client may
 * send over time. The rate limits (per source, per app) belong to the
 * reverse proxy; what only the application can do is bound the work a
 * single request may cause: the decompressed size (a gzip bomb is
 * invisible to the proxy), the item count, and the OTLP span count.
 */

/** The item types that legitimately make an envelope large. */
const LARGE_ITEM_MARKERS = ['"replay_recording"', '"attachment"'];

/**
 * The outer guard: the declared body size, checked before anything is
 * read. A request without a content length is rejected — the streaming
 * cap below is the real limit, this one is the cheap early exit.
 */
export function assertDeclaredSize(
  request: Request,
  maxBytes: number,
  what: string,
  options: { required?: boolean } = {},
): void {
  const declared = request.headers.get("content-length");
  if (declared === null) {
    if (!options.required) return;
    throw badRequest(`${what} requires a content-length header`);
  }
  const size = Number(declared);
  if (!Number.isFinite(size) || size < 0) {
    throw badRequest(`${what} has an invalid content-length header`);
  }
  if (size > maxBytes) {
    throw payloadTooLarge(`${what} exceeds the ${maxBytes} byte limit`);
  }
}

async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  what: string,
  growsWhenLarge: boolean,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  let limit = maxBytes;
  let large = false;
  let tail = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    const text = decoder.decode(value, { stream: true });
    chunks.push(text);
    if (growsWhenLarge && !large) {
      // The item headers are peeked as the body is consumed: a declared
      // attachment/replay item lifts the cap for the rest of the body. The
      // header precedes its payload, so the cap lifts in time.
      const haystack = tail + text;
      if (LARGE_ITEM_MARKERS.some((marker) => haystack.includes(marker))) {
        large = true;
        limit = rateLimitConfig().maxLargeEnvelopeBytes;
      }
      tail = haystack.slice(-64);
    }
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw payloadTooLarge(`${what} exceeds the ${limit} byte limit`);
    }
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

/**
 * The body, read with a hard cap. The gzip path is capped on the
 * decompressed size — that is the size that costs us memory.
 */
export async function readBodyCapped(
  request: Request,
  what = "Request body",
): Promise<string> {
  const config = rateLimitConfig();
  if (request.headers.get("content-encoding") === "gzip") {
    const gunzip = new DecompressionStream("gzip");
    const stream = request.body?.pipeThrough(gunzip);
    return await readCapped(
      stream ?? null,
      config.maxDecompressedBytes,
      what,
      false,
    );
  }
  return await readCapped(request.body, config.maxEnvelopeBytes, what, true);
}

/** The item-count cap of an envelope. */
export function assertItemCount(
  itemCount: number,
  what: string,
  maxItems?: number,
): void {
  const limit = maxItems ?? rateLimitConfig().maxEnvelopeItems;
  if (itemCount > limit) {
    throw payloadTooLarge(`${what} carries more than ${limit} items`);
  }
}

/** The span-count cap of an OTLP request. */
export function assertSpanCount(spanCount: number): void {
  const limit = rateLimitConfig().maxOtlpSpans;
  if (spanCount > limit) {
    throw payloadTooLarge(`OTLP request carries more than ${limit} spans`);
  }
}
