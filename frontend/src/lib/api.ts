import { treaty } from "@elysiajs/eden";

// Backend access from the SPA.
//
// Credential model (backend/auth.ts): one `authorization` header carrying
// `API-Key <admin-token>` (the master credential, rotated daily at 00:00 UTC —
// a stale token just fails and is re-prompted) or `Bearer <id>` (an OIDC
// provider JWT from the login flow in lib/oidc.ts). Only the raw token is
// stored — a single sessionStorage key, per-tab and cleared on close; the
// scheme is derived from the token shape (an ID token is a three-segment JWT),
// never persisted as a separate flag.

const TOKEN_KEY = "benemetrics.credential";

function isIdToken(token: string): boolean {
  return token.split(".").length === 3;
}

/** The raw credential, whichever surface is active. */
export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable/private mode: the session re-prompts per load.
  }
}

/** Decodes the ID token payload for display claims (name/email) — no
 * signature check here; the backend verifies the JWT on every request. */
export function readIdTokenClaims(): { name?: string; email?: string } {
  const idToken = getToken();
  if (!idToken || !isIdToken(idToken)) return {};
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return {};
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json) as { name?: unknown; email?: unknown };
    return {
      ...(typeof claims.name === "string" ? { name: claims.name } : {}),
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    };
  } catch {
    return {};
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  return {
    authorization: `${isIdToken(token) ? "Bearer" : "API-Key"} ${token}`,
  };
}

// The composed route tree does not flow through treaty's type-level mapping
// (same limitation the pre-rewrite client worked around with `as any`): the
// hooks declare the response shapes they read instead of trusting the proxy.
export const api = treaty(window.location.origin, {
  headers: (path, options) => authHeaders() as never,
}) as any;

// Cursor pages: a full page means there may be more (db/dao/cursor.ts).
export const PAGE_SIZE = 100;

export function isHttpError(res: {
  status?: number;
}): res is { status: number } {
  return typeof res.status === "number" && res.status >= 400;
}

// App DSNs are composed, never stored: the caller builds the SDK url for the
// origin it reached (apps carry publicKey + number only).
export function appDsn(app: { publicKey: string; number: number }): string {
  return `http://${app.publicKey}@${window.location.host}/${app.number}`;
}

/** The credential as the NATS auth callout expects it in CONNECT `auth_token`. */
export function feedCredential(): string | null {
  const token = getToken();
  if (!token) return null;
  return isIdToken(token) ? token : `API-Key ${token}`;
}
