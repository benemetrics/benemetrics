import { serviceUnavailable, unauthorized } from "backend/errors";
import { appDAO } from "db/dao/project";
import type { AppRecord } from "db/schema/project";
import { validateAuth } from "../auth";
import { publishEvent, type SentryEventMessage } from "../nats";

// DSNs generated for apps route ingestion through the app's numeric
// `number` (path segment) with the public key as the `sentry_key`
// credential; older DSNs use the ingest key or project id as the path
// segment. Unknown projects or keys are rejected: apps are only created
// through the admin API, never auto-provisioned by ingestion.
async function resolveApp(
  request: Request,
  projectId: string,
): Promise<AppRecord | undefined> {
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

  const apps = await appDAO.listRawByProject(projectId);
  const byProject = apps.find((app) => app.publicKey === requestKey);
  if (byProject) return byProject;

  return await appDAO.findByPublicKey(requestKey);
}

// Unknown projects/keys and a `sentry_key` that does not match the
// resolved app are rejected with 401 before any parsing or writes.
export async function resolveAuthorizedApp(
  request: Request,
  projectId: string,
): Promise<AppRecord> {
  const app = await resolveApp(request, projectId);
  if (!app || !validateAuth(request, app).valid) {
    throw unauthorized("Unauthorized - Invalid DSN");
  }
  return app;
}

export async function readBody(request: Request): Promise<string> {
  if (request.headers.get("Content-Encoding") === "gzip") {
    const gunzip = new DecompressionStream("gzip");
    const stream = request.body?.pipeThrough(gunzip);
    return await new Response(stream).text();
  }
  return await request.text();
}

// Ingestion is a publish: the side-effects consumer (Postgres) and the
// ClickHouse engine consumer each pull the message from JetStream with
// their own durable consumer. A publish failure is a 503 — at-least-once
// delivery is JetStream's job, never a second in-process write path.
export async function dispatchIngestedEvent(
  message: SentryEventMessage,
): Promise<void> {
  try {
    await publishEvent(message);
  } catch (err) {
    console.error(
      "[ingestion] Failed to publish event to NATS:",
      err instanceof Error ? err.message : err,
    );
    throw serviceUnavailable("Event ingestion is unavailable - the message broker is not connected");
  }
}
