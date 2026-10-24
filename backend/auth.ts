import { env } from "bun";
import { sourceMapTokenDAO, hashUploadToken } from "db/dao/source-map-tokens";
import type { SourceMapTokenAuthRecord } from "db/dao/source-map-tokens";
import { forbidden, serviceUnavailable, unauthorized } from "backend/errors";
import * as jose from "jose";
import * as client from 'openid-client';
import {
  NO_READ_PERMISSION_MESSAGE,
  isScopedReadPath,
  requireScopedRead,
  resolveAccessForIdentity,
} from './permissions/engine';
import type { PermissionScope } from './protocol/permissions';

// In-memory admin token — generated at boot if not set, rotated daily by cron.
// No env var, no file, no HTTP endpoint.
// Test-only: tests may set `globalThis.__ADMIN_TOKEN_FOR_TEST` before
// importing the backend to pin a deterministic value.
const TEST_TOKEN_KEY = Symbol.for("benemetrics.adminToken.test");
let adminToken: string | undefined = (globalThis as Record<symbol, string | undefined>)[TEST_TOKEN_KEY];

function ensureAdminToken(): void {
  if (!adminToken) adminToken = crypto.randomUUID();
}

export function getAdminToken(): string {
  ensureAdminToken();
  return adminToken!;
}

export function rotateAdminToken(): string {
  const newToken = crypto.randomUUID();
  adminToken = newToken;
  return newToken;
}


export interface SentryAuthTarget {
  publicKey: string;
}

export interface SentryAuthResult {
  valid: boolean;
  publicKey?: string;
}

export interface UploadAuthResult {
  valid: boolean;
  error?: string;
  token?: SourceMapTokenAuthRecord;
}

// A plain-HTTP issuer is refused by the OIDC client unless the deployment
// opts in: the tokens would travel in the clear. HTTPS is the
// recommendation; the opt-in exists for a local provider.
const allowInsecure = env.OIDC_ALLOW_INSECURE_HTTP === "true";
const config = env.OIDC_ISSUER && env.OIDC_CLIENT_ID
  ? await client.discovery(
    new URL(env.OIDC_ISSUER),
    env.OIDC_CLIENT_ID,
    env.OIDC_CLIENT_SECRET,
    undefined,
    allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
  )
  : null
const jwksURI = config?.serverMetadata().jwks_uri;
const jwks = jwksURI ? jose.createRemoteJWKSet(new URL(jwksURI), { timeoutDuration: 5_000, cacheMaxAge: 600_000 }) : null;

// The groups claim, split on the delimiters the common IdPs use.
function readGroups(payload: jose.JWTPayload): string[] {
  const claim = env.OIDC_GROUPS_CLAIM ?? "groups";
  const raw = payload[claim];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[\s,;|]+/)
      : [];
  return list
    .map((group) => String(group).trim().toLowerCase())
    .filter((group) => group.length > 0);
}

const verifyWithIdP = async (token: string) => {
  if (!jwks) return null;
  const clientId = env.OIDC_CLIENT_ID ?? env.OAUTH_CLIENT_ID;
  const issuer = env.OIDC_ISSUER;
  try {
    const { payload } = await jose.jwtVerify(token, jwks, {
      audience: clientId,
      requiredClaims: ["exp"],
      clockTolerance: 5, // max 5 s clock skew (default is 60 s)
      ...(issuer
        ? { issuer: [issuer, issuer.replace(/\/+$/, "")] }
        : {}),
    });
    // The authorized party must be this client.
    if (payload.azp !== undefined && payload.azp !== clientId) return null;
    return { id: `${payload.iss}-${payload.sub}`, groups: readGroups(payload) };
  } catch (error) {
    // A rejected token is an invalid credential; a provider that cannot be
    // reached is an outage — the two must not look the same.
    if (isProviderOutage(error)) {
      throw serviceUnavailable(
        "the identity provider could not be reached — the token was not verified",
      );
    }
    return null;
  }
}

// The JWKS fetch failed (the provider is down or the request timed out).
function isProviderOutage(error: unknown): boolean {
  if (error instanceof jose.errors.JWKSTimeout) return true;
  if (error instanceof jose.errors.JOSEError) return false;
  return true;
}

// The three credential surfaces of the API:
// - public: no credential (the UI bundle, the root redirect)
// - dsn: the SDK public key (ingestion, the flag evaluation)
// - oidc: the admin token (the master credential) or a verified provider identity (the admin surface)
//
// Every oidc route group resolves the identity through `resolveIdentity`,
// so the credential check lives in one place and fails closed before any handler runs.

export interface Identity {
  /** The id every grant keys on: `local-admin` or `<issuer>-<subject>`. */
  id: string;
  /** The token's groups claim, lowercased. */
  groups: string[];
  /** The master admin token — unrestricted, never scoped. */
  admin: boolean;
}

export async function resolveIdentity({ request }: { request: Request }): Promise<Identity> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) throw unauthorized();

  const [type, token] = authHeader.split(" ");
  if (!type || !token) throw unauthorized();

  switch (type) {
    case "API-Key": {
      const tokenValue = getAdminToken();
      const expected = tokenValue ? Buffer.from(tokenValue) : null;
      const given = Buffer.from(token);
      // The length check keeps a wrong-length credential a 401: the
      // constant-time compare throws on a mismatch.
      if (expected && given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
        return { id: "local-admin", groups: [], admin: true };
      }
      throw unauthorized();
    }
    case "Bearer": {
      const identity = await verifyWithIdP(token);
      if (identity) return { ...identity, admin: false };
      throw unauthorized();
    }
    default: throw unauthorized();
  }
}

// Elysia merges a resolve's return value into the context, so the identity
// travels as `adminId` / `adminGroups` / `isAdmin` / `adminScope` / `canWrite`.
export async function resolveAdminId({ request }: { request: Request }): Promise<{
  adminId: string;
  adminGroups: string[];
  isAdmin: boolean;
  adminScope: PermissionScope | null;
  canWrite: boolean;
}> {
  const identity = await resolveIdentity({ request });
  if (identity.admin) {
    return {
      adminId: identity.id,
      adminGroups: identity.groups,
      isAdmin: true,
      adminScope: null,
      canWrite: true,
    };
  }
  const access = await resolveAccessForIdentity(identity);
  if (!access) throw unauthorized(NO_READ_PERMISSION_MESSAGE);
  // The reads are allowlisted; a writer may also perform the writes.
  if (access.canWrite) {
    const isRead = request.method === "GET" || request.method === "HEAD";
    if (isRead && !isScopedReadPath(new URL(request.url).pathname)) {
      throw forbidden("Scoped identities are read-only");
    }
  } else {
    requireScopedRead(request);
  }
  return {
    adminId: identity.id,
    adminGroups: identity.groups,
    isAdmin: false,
    adminScope: access.scope,
    canWrite: access.canWrite,
  };
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

  // Bookkeeping for the admin token list; never fail an upload because
  // the usage timestamp could not be written.
  try {
    await sourceMapTokenDAO.touchLastUsed(token.id);
  } catch (error) {
    console.warn("[Auth] Failed to record upload token use:", error);
  }

  return { valid: true, token };
}
