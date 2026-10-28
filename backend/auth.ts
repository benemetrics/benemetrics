import { env } from "bun";
import { sourceMapTokenDAO, hashUploadToken } from "db/dao/source-map-tokens";
import type { SourceMapTokenAuthRecord } from "db/dao/source-map-tokens";
import { unauthorized } from "backend/errors";
import * as jose from "jose";
import * as client from 'openid-client';

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
      clockTolerance: 5,
      issuer,
    });

    // The authorized party must be this client.
    if (payload.azp !== undefined && payload.azp !== clientId) return null;
    return { id: `${payload.iss}-${payload.sub}`, groups: readGroups(payload) };
  } catch (error) {
    console.log(error);
    return null;
  }
}

export const resolveIdentity = async ({ request }: { request: Request }) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) throw unauthorized();

  const [type, token] = authHeader.split(" ");
  if (!type || !token) throw unauthorized();

  switch (type) {
    case "Bearer": {
      const identity = await verifyWithIdP(token);
      if (identity) return { user: identity };
      throw unauthorized();
    }
    default: throw unauthorized();
  }
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

// Tokens are scoped to one project and stored hashed;
// only the bearer (SENTRY_AUTH_TOKEN) or X-Upload-Token header is accepted.
export async function validateUploadAuth(request: Request): Promise<UploadAuthResult> {
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
