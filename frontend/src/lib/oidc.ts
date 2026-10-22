import * as client from "openid-client";
import authEnv from "virtual:auth-env";
import { getAdminToken, setAdminToken } from "./api";

// Authorization-code + PKCE login for the SPA, built on openid-client.
//
// Provider settings are compiled into the bundle from the server environment
// by `frontend/auth-env-plugin.ts` (`virtual:auth-env`); there is no runtime
// config endpoint. The browser discovers the provider, runs the authorization
// request with state/nonce/PKCE, exchanges the code, and stores the resulting
// ID token in the same slot as the admin token. The backend verifies that
// token against the provider's JWKS.
//
// `bootstrapOidc()` runs before React renders: with a provider configured and
// no token stored the browser is sent to the identity provider immediately.
// A failed exchange falls back to the admin-token prompt for the session
// instead of retrying in a loop.

const STATE_KEY = "benemetrics.oidc.state";
const VERIFIER_KEY = "benemetrics.oidc.verifier";
const NONCE_KEY = "benemetrics.oidc.nonce";
const FAILED_KEY = "benemetrics.oidc.failed";

const ISSUER = (authEnv.OIDC_ISSUER ?? authEnv.OAUTH_ISSUER)?.replace(
  /\/+$/,
  "",
);
const CLIENT_ID = authEnv.OIDC_CLIENT_ID ?? authEnv.OAUTH_CLIENT_ID;
const SCOPE = authEnv.OIDC_SCOPES ?? "openid email profile";
const ENABLED = Boolean(ISSUER && CLIENT_ID);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

let cached: {
  key: string;
  configuration: Promise<client.Configuration>;
} | null = null;

// Discovery is memoized per issuer/client id. HTTP issuers are only accepted
// for loopback (local development and e2e); everything else must use TLS.
function getConfiguration(): Promise<client.Configuration> {
  if (!ISSUER || !CLIENT_ID) {
    return Promise.reject(new Error("OIDC issuer/client id missing"));
  }

  const key = `${ISSUER}|${CLIENT_ID}`;
  if (cached?.key !== key) {
    const issuer = new URL(ISSUER);
    const configuration = client.discovery(
      issuer,
      CLIENT_ID,
      undefined,
      client.None(),
      {
        timeout: 10,
        ...(LOOPBACK_HOSTS.has(issuer.hostname)
          ? { execute: [client.allowInsecureRequests] }
          : {}),
      },
    );
    cached = { key, configuration };
    void configuration.catch(() => {
      if (cached?.configuration === configuration) cached = null;
    });
  }

  return cached.configuration;
}

function redirectUri(): string {
  return `${window.location.origin}/ui/auth/callback`;
}

function isCallbackPath(): boolean {
  return window.location.pathname.replace(/\/+$/, "").endsWith("/auth/callback");
}

async function startOidcLogin(): Promise<void> {
  const configuration = await getConfiguration();

  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomState();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(NONCE_KEY, nonce);

  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign(url.href);
}

async function completeOidcLogin(): Promise<boolean> {
  if (!ENABLED) return false;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const nonce = sessionStorage.getItem(NONCE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(NONCE_KEY);

  if (!code || !state || !verifier || !nonce || state !== expectedState) {
    return false;
  }

  const configuration = await getConfiguration();
  const tokens = await client.authorizationCodeGrant(
    configuration,
    new URL(window.location.href),
    {
      pkceCodeVerifier: verifier,
      expectedState,
      expectedNonce: nonce,
      idTokenExpected: true,
    },
  );

  // Throws when the ID token is missing or fails signature/claim validation.
  tokens.claims();
  if (typeof tokens.id_token !== "string" || tokens.id_token.length === 0) {
    return false;
  }

  setAdminToken(tokens.id_token, "oidc");
  return true;
}

/** Runs before the app renders; redirects into the provider when needed. */
export async function bootstrapOidc(): Promise<void> {
  try {
    if (isCallbackPath()) {
      const authenticated = await completeOidcLogin();
      if (authenticated) {
        sessionStorage.removeItem(FAILED_KEY);
      } else {
        // Do not bounce between the provider and the callback on a broken
        // exchange: fall back to the admin-token prompt for this session.
        sessionStorage.setItem(FAILED_KEY, "1");
      }
      window.location.replace("/ui/overview");
      return;
    }

    if (!ENABLED) return;

    if (getAdminToken()) {
      sessionStorage.removeItem(FAILED_KEY);
      return;
    }
    if (sessionStorage.getItem(FAILED_KEY)) return;

    await startOidcLogin();
  } catch {
    sessionStorage.setItem(FAILED_KEY, "1");
  }
}
