import * as client from "openid-client";
import authEnv from "./auth-env";
import { setToken } from "./api";

const STATE_KEY = "benemetrics.oidc.state";
const VERIFIER_KEY = "benemetrics.oidc.verifier";

const ENV_ISSUER = authEnv["OIDC_ISSUER"] ?? authEnv["OAUTH_ISSUER"];
const ISSUER = ENV_ISSUER?.replace(/\/+$/, "") ?? "";
const CLIENT_ID = authEnv["OIDC_CLIENT_ID"] ?? authEnv["OAUTH_CLIENT_ID"];
const SCOPE = [
  "openid",
  "groups",
  ...(authEnv["OIDC_SCOPES"] ?? "").split(/\s+/),
]
  .filter(
    (scope, index, all) => scope.length > 0 && all.indexOf(scope) === index,
  )
  .join(" ");

const ALLOW_INSECURE_HTTP = true;

const configuration =
  ISSUER &&
  CLIENT_ID &&
  (await client.discovery(
    new URL(ISSUER),
    CLIENT_ID,
    undefined,
    client.None(),
    {
      timeout: 10,
      ...(ALLOW_INSECURE_HTTP
        ? { execute: [client.allowInsecureRequests] }
        : {}),
    },
  ));

async function startOidcLogin(): Promise<void> {
  if (!configuration) return;

  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: `${window.location.origin}${window.location.pathname}`,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign(url.href);
}

const refresh = async (refreshToken: string) => {
  if (!configuration) return;
  const tokens = await client.refreshTokenGrant(configuration, refreshToken);
  await new Promise((res) =>
    setTimeout(res, ((tokens.expiresIn() ?? 1) * 1000) / 2),
  );
  setToken(tokens.id_token!);
  refresh(tokens.refresh_token!);
};

async function completeOidcLogin(): Promise<boolean> {
  if (!configuration) return false;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (!code || !state || !verifier || state !== expectedState) {
    return false;
  }

  const tokens = await client.authorizationCodeGrant(
    configuration,
    new URL(window.location.href),
    {
      expectedState,
      idTokenExpected: true,
      pkceCodeVerifier: verifier,
    },
  );

  history.replaceState(undefined, "", "/ui");
  refresh(tokens.refresh_token!);
  setToken(tokens.id_token!);
  return true;
}

/** Runs before the app renders; redirects into the provider when needed. */
export async function bootstrapOidc(): Promise<void> {
  try {
    const completed = await completeOidcLogin();
    if (completed) return;
    await startOidcLogin();
  } catch {}
}
