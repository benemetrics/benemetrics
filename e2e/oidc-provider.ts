/**
 * The suite's identity provider stub.
 *
 * openid-client refuses plain-HTTP issuers, so the stub serves the
 * discovery document and the JWKS over TLS with a self-signed certificate
 * the suite trusts through NODE_EXTRA_CA_CERTS (see e2e/oidc-fixture.ts).
 *
 * The module configures the environment at import time: the backend
 * discovers the provider when it boots, so the variables must be set
 * before any test file imports it. When the discovery is unreachable the
 * provider stays unconfigured and the suite runs without it.
 */
import * as jose from "jose";
import {
  ensureCertificate,
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
}

const shared = globalThis as {
  __sentryOidcProvider?: OidcProvider;
  __sentryOidcTrusted?: boolean;
};

let trusted = false;

async function startProvider(): Promise<OidcProvider> {
  const { cert, key } = ensureCertificate();
  const privateKey = await ensureSigningKey();
  const jwks = { keys: [readPublicJwk()] };

  let port = resolvePort();
  const handler = (request: Request): Response => {
    const { pathname } = new URL(request.url);
    const issuer = `https://localhost:${port}/`;
    if (pathname === "/.well-known/openid-configuration") {
      return Response.json({ issuer, jwks_uri: `${issuer}jwks` });
    }
    if (pathname === "/jwks") return Response.json(jwks);
    return new Response("not found", { status: 404 });
  };

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ port, tls: { cert, key }, fetch: handler });
  } catch {
    // The port is taken (another run): fall back to an ephemeral one and
    // remember it, so the issuer stays stable for the rest of the run.
    server = Bun.serve({ port: 0, tls: { cert, key }, fetch: handler });
    port = server.port ?? port;
    persistPort(port);
  }

  const issuer = `https://localhost:${port}/`;
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
  };

  // The backend discovers the provider when it boots and fails closed when
  // the discovery is unreachable, so the provider is only configured when
  // the document answers.
  try {
    const discovery = await fetch(`${issuer}.well-known/openid-configuration`);
    trusted = discovery.ok;
  } catch {
    console.warn(
      "[oidc] the provider stub is not reachable; run `bun scripts/oidc-fixture.ts` so the certificate is trusted",
    );
  }

  shared.__sentryOidcTrusted = trusted;
  return provider;
}

export const oidcProvider: OidcProvider = (shared.__sentryOidcProvider ??=
  await startProvider());

// The environment is re-asserted for every test file: a file may point the
// browser at its own loopback provider, and the next file needs the
// backend's issuer back. Without the trusted certificate the provider stays
// unconfigured — the backend would fail closed on the discovery.
if (shared.__sentryOidcTrusted) {
  process.env.OIDC_ISSUER = oidcProvider.issuer;
  process.env.OIDC_CLIENT_ID = oidcProvider.clientId;
  process.env.OIDC_AUDIENCE = oidcProvider.clientId;
}

/** The identity id the backend derives from a verified token. */
export function identityId(subject: string): string {
  return `${oidcProvider.issuer}-${subject}`;
}
