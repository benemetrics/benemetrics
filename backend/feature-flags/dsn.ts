import { unauthorized } from "backend/errors";
import { appDAO } from "db/dao/project";

/**
 * The SDK-facing flag surfaces authenticate with the DSN public key, the
 * same credential the ingestion uses: the key proves the caller is a
 * known SDK client and names the app, which carries the flag scope (the
 * project and the app). An unknown or missing key is rejected with 401
 * before any evaluation runs.
 */
export async function requireDsnKey(request: Request): Promise<FlagApp> {
  const authHeader = request.headers.get("X-Sentry-Auth");
  const key =
    authHeader?.match(/sentry_key=([^,]+)/)?.[1] ??
    new URL(request.url).searchParams.get("sentry_key");
  if (!key) {
    throw unauthorized("Unauthorized - Missing DSN key");
  }
  const app = await appDAO.findByPublicKey(key);
  if (!app) {
    throw unauthorized("Unauthorized - Invalid DSN");
  }
  return app;
}

/** The app the SDK belongs to. */
export interface FlagApp {
  id: string;
  projectId: string;
}

/** The scope a flag is resolved in: the project, narrowed to the app. */
export function scopeOf(app: { id: string; projectId: string }): {
  projectId: string;
  appId: string;
} {
  return { projectId: app.projectId, appId: app.id };
}
