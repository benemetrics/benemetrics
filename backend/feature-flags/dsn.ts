import { unauthorized } from "backend/errors";
import { appDAO } from "db/dao/apps";

/** The app the SDK belongs to. */
export interface FlagApp {
  id: string;
  projectId: string;
}

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

/**
 * OFREP surfaces accept the same DSN public key under the spec headers
 * (`X-API-Key` or `Authorization: Bearer`), the legacy `X-Sentry-Auth`
 * DSN syntax, or — for EventSource, which cannot set headers — the
 * `api_key`/`sentry_key` query parameters.
 */
export async function requireOfrepKey(
  request: Request,
  query?: { api_key?: string; sentry_key?: string },
): Promise<FlagApp & { publicKey: string }> {
  const key =
    request.headers.get("X-API-Key")?.trim() ||
    request.headers
      .get("Authorization")
      ?.match(/^Bearer\s+(.+)$/)?.[1]
      ?.trim() ||
    query?.api_key ||
    query?.sentry_key ||
    request.headers.get("X-Sentry-Auth")?.match(/sentry_key=([^,]+)/)?.[1] ||
    new URL(request.url).searchParams.get("sentry_key");
  if (!key) {
    throw unauthorized("Unauthorized - Missing API key");
  }
  const app = await appDAO.findByPublicKey(key);
  if (!app) {
    throw unauthorized("Unauthorized - Invalid API key");
  }
  return { ...app, publicKey: key };
}

/** The scope a flag is resolved in: the project, narrowed to the app. */
export function scopeOf(app: { id: string; projectId: string }): {
  projectId: string;
  appId: string;
} {
  return { projectId: app.projectId, appId: app.id };
}
