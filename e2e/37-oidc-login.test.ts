/**
 * E2E: OIDC login flow from startup.
 *
 * With a provider configured and no token stored, the SPA must immediately
 * redirect to the provider's authorization endpoint (authorization code +
 * PKCE via openid-client), exchange the code in the browser, store the
 * returned ID token and render the authenticated UI. The token must then
 * authenticate the admin API.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as jose from "jose";
import { ensureSigningKey, readPublicJwk } from "./oidc-fixture";

const CLIENT_ID = "e2e-spa";
const EMAIL = "sso@example.com";

let app: typeof import("../backend/index")["default"];
let provider: ReturnType<typeof Bun.serve>;
let issuer = "";
let baseUrl = "";
let view: Bun.WebView;
let privateKey: CryptoKey;
let authorizeParams: URLSearchParams | null = null;
const pending = new Map<string, { challenge: string; nonce: string }>();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

function json(value: unknown): Response {
  return Response.json(value, { headers: CORS });
}

beforeAll(async () => {
  // The provider signs with the suite's key, so the backend verifies the
  // browser's ID token against the published JWKS.
  privateKey = await ensureSigningKey();
  const publicJwk = readPublicJwk();

  provider = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }

      const url = new URL(request.url);

      if (url.pathname === "/.well-known/openid-configuration") {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid", "email", "profile"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      }

      if (url.pathname === "/authorize") {
        authorizeParams = url.searchParams;
        const redirect = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        const code = crypto.randomUUID();
        pending.set(code, {
          challenge: url.searchParams.get("code_challenge") ?? "",
          nonce,
        });

        const location = new URL(redirect);
        location.searchParams.set("code", code);
        location.searchParams.set("state", state);
        return new Response(null, {
          status: 302,
          headers: { ...CORS, location: location.toString() },
        });
      }

      if (url.pathname === "/token") {
        const form = new URLSearchParams(await request.text());
        const code = form.get("code") ?? "";
        const verifier = form.get("code_verifier") ?? "";
        const grant = pending.get(code);
        pending.delete(code);

        if (!grant || grant.challenge !== (await challengeOf(verifier))) {
          return Response.json(
            { error: "invalid_grant" },
            { status: 400, headers: CORS },
          );
        }

        const idToken = await new jose.SignJWT({
          sub: "oidc-user-1",
          email: EMAIL,
          name: "SSO User",
          nonce: grant.nonce,
        })
          .setProtectedHeader({ alg: "RS256", kid: "e2e-key" })
          .setIssuer(issuer)
          .setAudience(CLIENT_ID)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);

        return json({
          access_token: "e2e-access-token",
          token_type: "Bearer",
          id_token: idToken,
        });
      }

      if (url.pathname === "/jwks") {
        return json({ keys: [publicJwk] });
      }

      return new Response("not found", { status: 404, headers: CORS });
    },
  });
  issuer = `http://127.0.0.1:${provider.port}`;

  // The backend discovers the provider when it boots and openid-client
  // refuses plain HTTP, so the backend keeps the suite's TLS provider.
  // The browser talks to the loopback provider above (the SPA accepts HTTP
  // on loopback), so the frontend bundle is built with that issuer.
  app = (await import("../backend/index")).default;
  app.listen(0);
  baseUrl = `http://localhost:${(app as any).server.port}`;

  process.env.OIDC_ISSUER = issuer;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  process.env.OIDC_AUDIENCE = CLIENT_ID;

  // The grant for the browser's identity: the id is `<issuer>-<subject>`.
  const granted = await fetch(`${baseUrl}/api/admin/permissions/grants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "API-Key e2e-admin-token",
    },
    body: JSON.stringify({
      identityId: `${issuer}-oidc-user-1`,
      label: "e2e spa identity",
      environments: [],
      appPrefixes: [],
    }),
  });
  expect(granted.status).toBe(200);

  view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
  await view.navigate(`${baseUrl}/ui/overview`);
}, 30000);

afterAll(async () => {
  await view?.close();
  (app as any)?.server?.stop(true);
  provider?.stop(true);
  delete process.env.OIDC_SCOPES;
});

// PKCE S256 challenge, matching openid-client's calculation.
async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function waitForEmail(timeoutMs = 20000): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body?.innerText ?? ''")) ?? "";
    if (body.includes(EMAIL)) return body;
    await Bun.sleep(250);
  }
  const location = await view.evaluate("window.location.href");
  throw new Error(
    `OIDC login did not complete within ${timeoutMs}ms at ${location}. ` +
      `authorize params: ${authorizeParams?.toString() ?? "not hit"}. ` +
      `Page text: ${body.slice(0, 400)}`,
  );
}

describe("OIDC login from startup", () => {
  it("redirects to the provider with PKCE and returns authenticated", async () => {
    const body = await waitForEmail();
    expect(body).toContain("SSO User");

    const params = authorizeParams;
    if (!params) throw new Error("provider authorization endpoint was not hit");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("state")).toBeTruthy();
    expect(params.get("nonce")).toBeTruthy();
    expect(params.get("redirect_uri")).toBe(`${baseUrl}/ui/auth/callback`);

    const path = await view.evaluate("window.location.pathname");
    expect(path).toBe("/ui/overview");
  }, 30000);

  it("stores the ID token as the bearer credential", async () => {
    const stored = await view.evaluate(
      `localStorage.getItem("benemetrics.adminToken")`,
    );
    expect(typeof stored).toBe("string");
    expect(String(stored).split(".")).toHaveLength(3);

    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      headers: { Authorization: `Bearer ${stored}` },
    });
    expect(response.status).toBe(200);
  });

  it("does not show the admin-token prompt", async () => {
    const hasDialog = await view.evaluate(
      `document.querySelector('[role="dialog"]') !== null`,
    );
    expect(hasDialog).toBe(false);
  });
});
