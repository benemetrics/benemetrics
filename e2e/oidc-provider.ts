/**
 * The suite's identity provider stub.
 *
 * The stub serves the discovery document and the JWKS over plain HTTP: the
 * OIDC client refuses an insecure issuer unless the deployment opts in
 * (OIDC_ALLOW_INSECURE_HTTP), and the suite does — a local stub has no
 * secret to protect. HTTPS is the recommendation for a real provider.
 *
 * The module configures the environment at import time: the backend
 * discovers the provider when it boots, so the variables must be set
 * before any test file imports it. When the discovery is unreachable the
 * provider stays unconfigured and the suite runs without it.
 */
import * as jose from "jose";
import {
  ensureSigningKey,
  persistPort,
  readPublicJwk,
  resolvePort,
} from "./oidc-fixture";

export const OIDC_CLIENT_ID = "e2e-oidc-client";

export interface SignOptions {
  audience?: string | string[];
  claims?: Record<string, unknown>;
  issuer?: string;
  expiresIn?: string | null;
  alg?: string;
}

export interface OidcProvider {
  issuer: string;
  clientId: string;
  /** The published JWK set (the stub's `/jwks`). */
  jwks: { keys: Record<string, unknown>[] };
  sign(options?: SignOptions): Promise<string>;
  revoke(token: string): void;
}

const shared = globalThis as {
  __sentryOidcProvider?: OidcProvider;
  __sentryOidcTrusted?: boolean;
};

let trusted = false;

async function startProvider(): Promise<OidcProvider> {
  const privateKey = await ensureSigningKey();
  const jwks = { keys: [readPublicJwk()] };

  let port = resolvePort();
  const revoked = new Set<string>();
  const handler = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const issuer = `http://localhost:${port}/`;
    if (pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer,
        jwks_uri: `${issuer}jwks`,
        introspection_endpoint: `${issuer}introspect`,
      });
    }
    if (pathname === "/jwks") return Response.json(jwks);
    if (pathname === "/introspect") {
      const form = new URLSearchParams(await request.text());
      return Response.json({ active: !revoked.has(form.get("token") ?? "") });
    }
    return new Response("not found", { status: 404 });
  };

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ port, fetch: handler });
  } catch {
    // The port is taken (another run): fall back to an ephemeral one and
    // remember it, so the issuer stays stable for the rest of the run.
    server = Bun.serve({ port: 0, fetch: handler });
    port = server.port ?? port;
    persistPort(port);
  }

  const issuer = `http://localhost:${port}/`;
  const provider: OidcProvider = {
    issuer,
    clientId: OIDC_CLIENT_ID,
    jwks,
    async sign(options: SignOptions = {}): Promise<string> {
      let jwt = new jose.SignJWT({
        email: "oidc@example.com",
        name: "OIDC User",
        ...options.claims,
      })
        .setProtectedHeader({ alg: options.alg ?? "RS256", kid: "e2e-key" })
        .setIssuer(options.issuer ?? issuer)
        .setAudience(options.audience ?? OIDC_CLIENT_ID)
        .setIssuedAt();
      if (options.expiresIn !== null) {
        jwt = jwt.setExpirationTime(options.expiresIn ?? "5m");
      }
      return jwt.sign(privateKey);
    },
    revoke(token: string): void {
      revoked.add(token);
    },
  };

  // The backend discovers the provider when it boots and fails closed when
  // the discovery is unreachable, so the provider is only configured when
  // the document answers.
  try {
    const discovery = await fetch(`${issuer}.well-known/openid-configuration`);
    trusted = discovery.ok;
  } catch {
    console.warn(
      "[oidc] the provider stub is not reachable; the suite runs without it",
    );
  }

  shared.__sentryOidcTrusted = trusted;
  return provider;
}

export const oidcProvider: OidcProvider = (shared.__sentryOidcProvider ??=
  await startProvider());

// The environment is re-asserted for every test file: a file may point the
// browser at its own loopback provider, and the next file needs the
// backend's issuer back. Without a reachable discovery the provider stays
// unconfigured — the backend would fail closed on the discovery.
if (shared.__sentryOidcTrusted) {
  process.env.OIDC_ISSUER = oidcProvider.issuer;
  process.env.OIDC_CLIENT_ID = oidcProvider.clientId;
  process.env.OIDC_AUDIENCE = oidcProvider.clientId;
  // The stub speaks plain HTTP, so the OIDC client has to be told that the
  // insecure issuer is allowed.
  process.env.OIDC_ALLOW_INSECURE_HTTP = "true";
  // The stub exposes an introspection endpoint: exercise RFC 7662 revocation.
  process.env.OIDC_INTROSPECTION = "true";
}

/** The identity id the backend derives from a verified token. */
export function identityId(subject: string): string {
  return `${oidcProvider.issuer}-${subject}`;
}
