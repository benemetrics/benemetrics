import { serviceUnavailable, unauthorized } from "backend/errors";
import { appDAO, type AppResolveRecord } from "db/dao/project";
import { validateAuth } from "../auth";
import { readBodyCapped } from "../ratelimit/hygiene";
import { publishEvent, publishMetricSamples } from "../nats";
import type { SentryEventMessage } from "../protocol/events";
import type { MetricSample } from "../protocol/metrics";

// DSNs generated for apps route ingestion through the app's numeric
// `number` (path segment) with the public key as the `sentry_key`
// credential; older DSNs use the ingest key or project id as the path
// segment. Unknown projects or keys are rejected: apps are only created
// through the admin API, never auto-provisioned by ingestion.
async function resolveApp(
  request: Request,
  projectId: string,
): Promise<AppResolveRecord | undefined> {
  const authHeader = request.headers.get("X-Sentry-Auth");
  const requestKey =
    authHeader?.match(/sentry_key=([^,]+)/)?.[1] ??
    new URL(request.url).searchParams.get("sentry_key");

  if (!requestKey) return undefined;

  if (/^\d+$/.test(projectId)) {
    const numericId = Number(projectId);
    if (Number.isSafeInteger(numericId)) {
      const byNumber = await appDAO.findByNumber(numericId);
      if (byNumber) return byNumber;
    }
  }

  const byIngestKey = await appDAO.findByIngestKey(projectId);
  if (byIngestKey) return byIngestKey;

  const byProject = await appDAO.findByProjectAndPublicKey(projectId, requestKey);
  if (byProject) return byProject;

  return await appDAO.findByPublicKey(requestKey);
}

// Unknown projects/keys and a `sentry_key` that does not match the
// resolved app are rejected with 401 before any parsing or writes.
export async function resolveAuthorizedApp(
  request: Request,
  projectId: string,
): Promise<AppResolveRecord> {
  const app = await resolveApp(request, projectId);
  if (!app || !validateAuth(request, app).valid) {
    throw unauthorized("Unauthorized - Invalid DSN");
  }
  return app;
}

export async function readBody(request: Request): Promise<string> {
  return await readBodyCapped(request);
}

const RECENT_ID_TTL_MS = 60_000;
const RECENT_ID_MAX = 50_000;
const recentIds = new Map<string, number>();

export function wasRecentlyIngested(eventId: string): boolean {
  const seenAt = recentIds.get(eventId);
  if (seenAt === undefined) return false;
  if (Date.now() - seenAt > RECENT_ID_TTL_MS) {
    recentIds.delete(eventId);
    return false;
  }
  return true;
}

export function markIngested(eventId: string): void {
  if (recentIds.size >= RECENT_ID_MAX) {
    const oldest = recentIds.keys().next().value;
    if (oldest !== undefined) recentIds.delete(oldest);
  }
  recentIds.set(eventId, Date.now());
}

interface BufferedEvent {
  appNumber: number;
  event: Uint8Array;
  samples: Uint8Array[];
}

const BATCH_FLUSH_MS = 100;
const BATCH_MAX_SIZE = 2000;
const eventBuffer: BufferedEvent[] = [];
let isFlushing = false;
const encoder = new TextEncoder();

async function flushBuffer(): Promise<void> {
  if (isFlushing || eventBuffer.length === 0) return;
  isFlushing = true;
  const batch = eventBuffer.splice(0, eventBuffer.length);

  try {
    const newline = encoder.encode("\n");
    const byApp = new Map<number, { eventChunks: Uint8Array[]; sampleChunks: Uint8Array[] }>();
    for (const b of batch) {
      const bucket = byApp.get(b.appNumber) ?? { eventChunks: [], sampleChunks: [] };
      bucket.eventChunks.push(b.event, newline);
      for (const s of b.samples) bucket.sampleChunks.push(s, newline);
      byApp.set(b.appNumber, bucket);
    }

    await Promise.all(
      [...byApp].map(([appNumber, { eventChunks, sampleChunks }]) =>
        Promise.all([
          publishEvent(appNumber, eventChunks),
          sampleChunks.length > 0 ? publishMetricSamples(sampleChunks) : Promise.resolve(),
        ]),
      ),
    );
  } catch (err) {
    console.error(
      "[ingestion] Flush failed:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    isFlushing = false;
  }
}

setInterval(() => flushBuffer(), BATCH_FLUSH_MS);

export async function dispatchIngestedEvent(
  app: AppResolveRecord,
  message: SentryEventMessage,
  samples: MetricSample[] = [],
): Promise<void> {
  const event = encoder.encode(JSON.stringify(message));
  const sampleChunks = samples.map((s) =>
    encoder.encode(JSON.stringify({ ...s, tags: JSON.stringify(s.tags ?? {}) })),
  );

  if (eventBuffer.push({ appNumber: app.number, event, samples: sampleChunks }) >= BATCH_MAX_SIZE) {
    await flushBuffer();
  }
}
