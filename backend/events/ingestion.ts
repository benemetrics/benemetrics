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

// A client that retries the same event in a loop must not make the server
// do the work again. The event id is the idempotency key, so a recently
// seen id is answered without an object-store write or a publish.
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

// Ingestion is a publish: the side-effects consumer (Postgres) and the
// ClickHouse engine consumer each pull the event message from JetStream
// with their own durable consumer, and the extracted metric samples go to
// `sentry.metrics` (the ClickHouse metrics engine inserts them). A publish
// failure is a 503 — at-least-once delivery is JetStream's job, never a
// second in-process write path.
export async function dispatchIngestedEvent(
  message: SentryEventMessage,
  samples: MetricSample[] = [],
): Promise<void> {
  try {
    await Promise.all([publishEvent(message), publishMetricSamples(samples)]);
  } catch (err) {
    console.error(
      "[ingestion] Failed to publish event to NATS:",
      err instanceof Error ? err.message : err,
    );
    throw serviceUnavailable("Event ingestion is unavailable - the message broker is not connected");
  }
}
