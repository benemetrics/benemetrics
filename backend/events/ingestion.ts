import { unauthorized } from "backend/errors";
import { appDAO } from "db/dao/project";
import type { AppRecord } from "db/schema/project";
import { validateAuth } from "../auth";
import { publishEvent, type SentryEventMessage } from "../nats";
import { applyEventMessage } from "../events-consumer";
import { enqueueReleaseEvent } from "../releases-consumer";

// DSNs generated for apps route ingestion through the app's ingest key
// (path segment) with the public key as the `sentry_key` credential;
// older DSNs use the project id as the path segment. Unknown projects or
// keys are rejected: apps are only created through the admin API, never
// auto-provisioned by ingestion.
async function resolveApp(
  request: Request,
  projectId: string,
): Promise<AppRecord | undefined> {
  const authHeader = request.headers.get("X-Sentry-Auth");
  const requestKey =
    authHeader?.match(/sentry_key=([^,]+)/)?.[1] ??
    new URL(request.url).searchParams.get("sentry_key");

  if (!requestKey) return undefined;

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

// NATS-first: when the broker is connected the consumers persist the
// event; without NATS the same applyEventMessage path runs in-process,
// followed by release metrics. Duplicate event ids stay idempotent on
// both paths.
export async function dispatchIngestedEvent(
  message: SentryEventMessage,
): Promise<void> {
  if (await publishEvent(message)) return;

  const stored = await applyEventMessage(message);
  if (stored) enqueueReleaseEvent(message);
}
