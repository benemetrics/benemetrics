/**
 * NATS auth callout service (ADR-26): answers `$SYS.REQ.USER.AUTH` with a
 * signed, sub-only user claim that binds each browser connection to the
 * apps its permission scope resolves to. No reply = denied.
 */

import { env } from "bun";
import type { NatsConnection, Msg } from "@nats-io/transport-node";
import {
  decode,
  encodeAuthorizationResponse,
  encodeUser,
} from "@nats-io/jwt";
import { resolveIdentity } from "./auth";
import {
  computeScopedView,
  resolveAccessForIdentity,
} from "./permissions/engine";
import { EVENTS_STREAM_SUBJECT, eventsSubject } from "./nats";
import { appDAO } from "db/dao/project";

const AUTH_REQUEST_SUBJECT = "$SYS.REQ.USER.AUTH";
// The minted credential never outlives a day even when the IdP token does.
const MAX_CLAIM_TTL_SECONDS = 24 * 60 * 60;
// App numbers move with app/project churn; the cache only shortens the
// per-connection lookup burst.
const APP_NUMBER_CACHE_TTL_MS = 30_000;

/**
 * The account the callout binds admitted readers to. Everything shares the
 * global account: the per-user sub-only claim is the isolation (an account
 * split would need stream imports to deliver anything to the readers).
 */
const GLOBAL_ACCOUNT = "$G";

function readIssuerSeed(): string {
  const issuerSeed = env.NATS_AUTH_KEY_SEED;
  if (!issuerSeed) {
    throw new Error(
      "NATS_AUTH_KEY_SEED is not configured — the auth callout cannot sign verdicts",
    );
  }
  return issuerSeed;
}

let numbersCache: { at: number; map: Map<string, number> } | null = null;

async function appNumbersByAppId(): Promise<Map<string, number>> {
  if (numbersCache && Date.now() - numbersCache.at < APP_NUMBER_CACHE_TTL_MS) {
    return numbersCache.map;
  }
  const map = new Map<string, number>();
  for (const app of await appDAO.listAll()) map.set(app.id, app.number);
  numbersCache = { at: Date.now(), map };
  return map;
}

/**
 * The subscribe allowlist for the identity: the admin token sees every
 * shard; a scoped identity only the `sentry.events.<appNumber>` of the apps
 * its scope resolves to. An empty allowlist denies the connection.
 */
async function subjectsForIdentity(identity: {
  id: string;
  groups: string[];
  admin: boolean;
}): Promise<string[]> {
  if (identity.admin) return [EVENTS_STREAM_SUBJECT];
  const access = await resolveAccessForIdentity(identity);
  if (!access) return [];
  const [view, numbers] = await Promise.all([
    computeScopedView(access.scope),
    appNumbersByAppId(),
  ]);
  const subjects: string[] = [];
  for (const appId of view.appIds) {
    const number = numbers.get(appId);
    if (number !== undefined) subjects.push(eventsSubject(number));
  }
  return subjects;
}

// The callout request's claims: ADR-26 nests the authorization request in
// the `nats` claim of the server-signed JWT.
interface AuthRequestClaim {
  type: string;
  user_nkey: string;
  server_id: { id: string };
  connect_opts: { auth_token?: string };
}

/**
 * Verifies the presented credential exactly like an HTTP request and maps
 * it to the connection's subjects. Any failure denies by returning null.
 */
async function admit(
  token: string | undefined,
  adminTokenHash: string,
): Promise<string[] | null> {
  if (!token) return null;

  const headers = new Headers({
    authorization: token.startsWith("API-Key ") ? token : `Bearer ${token}`,
  });
  let identity;
  try {
    identity = await resolveIdentity({
      request: new Request("http://callout.local/", { headers }),
      adminTokenHash,
    });
  } catch {
    return null;
  }
  const subjects = await subjectsForIdentity(identity);
  return subjects.length > 0 ? subjects : null;
}

async function handleAuthRequest(
  msg: Msg,
  issuerSeed: string,
  getAdminTokenHash: () => string | Promise<string>,
): Promise<void> {
  // decode verifies the server's signature; a non-callout payload is ignored.
  let request: AuthRequestClaim;
  try {
    const claim = decode<{ nats: AuthRequestClaim }>(msg.string());
    if (claim.nats?.type !== "authorization_request") return;
    request = claim.nats;
  } catch {
    return;
  }

  const userNkey = request.user_nkey;
  const serverId = request.server_id?.id;
  if (!userNkey || !serverId) return; // deny by silence

  const subjects = await admit(request.connect_opts?.auth_token, await getAdminTokenHash());
  if (!subjects || subjects.length === 0) return;

  const expires = Math.floor(Date.now() / 1000) + MAX_CLAIM_TTL_SECONDS;
  // Sub-only: an allowlisted direction with an empty list denies everything.
  const userJwt = await encodeUser(
    "live-feed",
    userNkey,
    issuerSeed,
    {
      sub: { allow: subjects },
      pub: { allow: [] },
      subs: -1,
      data: -1,
      payload: -1,
    },
    { aud: GLOBAL_ACCOUNT, exp: expires },
  );
  const response = await encodeAuthorizationResponse(
    userNkey,
    serverId,
    issuerSeed,
    { jwt: userJwt },
    {},
  );
  msg.respond(new TextEncoder().encode(response));
}

/**
 * Subscribes to the callout subject and answers connection attempts. Runs
 * inside the backend process; the backend's own connection (a config user)
 * is exempt from the callout via `auth_users`.
 */
export function startAuthCallout(
  nc: NatsConnection,
  getAdminTokenHash: () => string | Promise<string>,
): void {
  const issuerSeed = readIssuerSeed();
  void nc.subscribe(AUTH_REQUEST_SUBJECT, {
    queue: "auth-callout",
    callback: (err, msg) => {
      if (err || !msg.respond) return;
      void handleAuthRequest(msg, issuerSeed, getAdminTokenHash).catch((error) => {
        // A failed verdict denies the connection (no reply); log server-side.
        console.error(
          "[auth-callout] Failed to answer an authorization request:",
          error instanceof Error ? error.message : error,
        );
      });
    },
  });
  console.log("[NATS] Auth callout service subscribed");
}
