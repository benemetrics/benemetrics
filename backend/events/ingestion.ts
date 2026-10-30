import { serviceUnavailable, unauthorized } from "backend/errors";
import { appDAO } from "db/dao/apps";
import { validateAuth } from "../auth";
import { readBodyCapped } from "../ratelimit/hygiene";

// DSNs generated for apps route ingestion through the app's numeric
// `number` (path segment) with the public key as the `sentry_key`
// credential; older DSNs use the ingest key or project id as the path
// segment. Unknown projects or keys are rejected: apps are only created
// through the admin API, never auto-provisioned by ingestion.
interface AppResolveRecord {
  id: string;
  number: number;
  appNumber: number;
  projectId: string;
  publicKey: string;
  ingestKey: string;
}

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

  const byProject = await appDAO.findByProjectAndPublicKey(
    projectId,
    requestKey,
  );
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

