import { sourceMapTokenDAO, hashUploadToken } from "db/dao/source-map-tokens";
import type { SourceMapToken } from "db/schema/source-map-tokens";

export interface SentryAuthTarget {
  publicKey: string;
}

export interface SentryAuthResult {
  valid: boolean;
  publicKey?: string;
}

export interface AdminAuthResult {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
  error?: string;
}

export interface UploadAuthResult {
  valid: boolean;
  error?: string;
  token?: SourceMapToken;
}

// Sentry SDK authentication: the DSN public key is sent either as the
// `sentry_key` query parameter or inside the `X-Sentry-Auth` header.
export function validateAuth(request: Request, target: SentryAuthTarget): SentryAuthResult {
  const authHeader = request.headers.get("X-Sentry-Auth");
  const url = new URL(request.url);

  const sentryKey =
    url.searchParams.get("sentry_key") ?? authHeader?.match(/sentry_key=([^,]+)/)?.[1];

  if (!sentryKey) return { valid: false };

  return { valid: sentryKey === target.publicKey, publicKey: sentryKey };
}

const ADMIN_USER = {
  id: "admin-1",
  email: "admin@company.com",
  name: "Admin User",
  roles: ["admin"],
};

// An identity provider is considered configured when any of its settings
// are present in the environment. No OIDC/OAuth flow is implemented yet;
// the flag only forces admin credentials on the dev-open UI surfaces.
export function isAuthProviderConfigured(): boolean {
  return Boolean(
    process.env.OIDC_ISSUER ||
      process.env.OIDC_CLIENT_ID ||
      process.env.OAUTH_ISSUER ||
      process.env.OAUTH_CLIENT_ID,
  );
}

// Whether admin credentials are enforced on the UI surfaces that are
// otherwise open in dev (/events, /storage). Always enforced in
// production, or when ADMIN_TOKEN / an identity provider is configured.
export function adminAuthEnforced(): boolean {
  return (
    Boolean(process.env.ADMIN_TOKEN) ||
    process.env.NODE_ENV === "production" ||
    isAuthProviderConfigured()
  );
}

// Startup banner so the effective admin auth mode is never a guess: identity
// provider vs ADMIN_TOKEN vs locked. Never prints secrets.
export function logAuthMode(): void {
  if (isAuthProviderConfigured()) {
    console.log(
      "[Auth] OIDC/OAuth2 is configured — admin API requires the identity provider; ADMIN_TOKEN is ignored",
    );
    return;
  }

  if (process.env.ADMIN_TOKEN) {
    console.log("[Auth] ADMIN_TOKEN is set — admin API requires the configured token");
    return;
  }

  console.warn(
    "[Auth] ADMIN_TOKEN is not set — /api/admin/* rejects every request (set ADMIN_TOKEN to log in)",
  );
}

function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// Admin token check, shared by HTTP (Authorization header) and WebSocket
// upgrades (browsers cannot set headers, so the token may arrive as a query
// parameter instead). ADMIN_TOKEN is the credential only while no
// OIDC/OAuth2 env is configured; once a provider is configured the token is
// ignored and the provider flow takes over (not implemented yet, so this
// fails closed instead of silently falling back).
export function validateAdminToken(
  token: string | null | undefined,
): AdminAuthResult {
  if (isAuthProviderConfigured()) {
    return { valid: false, error: "Identity provider authentication required" };
  }

  if (!token) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && constantTimeEquals(token, adminToken)) {
    return { valid: true, user: { ...ADMIN_USER } };
  }

  return { valid: false, error: "Invalid or expired token" };
}

// Admin authentication: Bearer ADMIN_TOKEN, accepted only while no identity
// provider is configured.
export function validateAdminAuth(request: Request): AdminAuthResult {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  return validateAdminToken(authHeader.slice(7).trim());
}

// Tokens are scoped to one project + environment and stored hashed;
// only the bearer (SENTRY_AUTH_TOKEN) or X-Upload-Token header is accepted.
export async function validateUploadAuth(
  request: Request,
): Promise<UploadAuthResult> {
  const bearer = request.headers.get("Authorization");
  const raw =
    (bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined) ??
    request.headers.get("X-Upload-Token");

  if (!raw) return { valid: false, error: "Missing upload token" };

  const token = await sourceMapTokenDAO.findByHash(hashUploadToken(raw));
  if (!token) return { valid: false, error: "Invalid upload token" };
  if (token.revokedAt)
    return { valid: false, error: "Revoked upload token" };
  if (token.expiresAt && token.expiresAt <= new Date().toISOString())
    return { valid: false, error: "Expired upload token" };

  return { valid: true, token };
}
