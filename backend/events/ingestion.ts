import { internalError, serviceUnavailable, unauthorized } from "backend/errors";
import { appDAO } from "db/dao/apps";
import { validateAuth } from "../auth";
import { readBodyCapped } from "../ratelimit/hygiene";

// DSNs generate for apps route ingestion through the app's numeric
// `number` (path segment) with the public key as the `sentry_key`
// credential; the public key alone is the legacy fallback path.
// Unknown projects or keys are rejected: apps are only created
// through the admin API, never auto-provisioned by ingestion.
interface AppResolveRecord {
  id: string;
  number: number;
  projectId: string;
  publicKey: string;
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
