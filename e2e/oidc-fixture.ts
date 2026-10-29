/**
 * The identity provider stub's key material.
 *
 * The signing key pair is persisted so the published JWKS stays valid for
 * the whole run, and the port is persisted so the issuer stays stable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as jose from "jose";

export const OIDC_FIXTURE_DIR = join(tmpdir(), "sentry-e2e-oidc");
export const OIDC_SIGNING_PRIVATE_PATH = join(
  OIDC_FIXTURE_DIR,
  "signing-private.jwk",
);
export const OIDC_SIGNING_PUBLIC_PATH = join(
  OIDC_FIXTURE_DIR,
  "signing-public.jwk",
);
export const OIDC_PORT_PATH = join(OIDC_FIXTURE_DIR, "port");

export function ensureFixtureDir(): void {
  mkdirSync(OIDC_FIXTURE_DIR, { recursive: true });
}

/** The signing key pair, persisted so the published JWKS stays valid. */
export async function ensureSigningKey(): Promise<CryptoKey> {
  ensureFixtureDir();
  if (
    !existsSync(OIDC_SIGNING_PRIVATE_PATH) ||
    !existsSync(OIDC_SIGNING_PUBLIC_PATH)
  ) {
    const pair = await jose.generateKeyPair("RS256", { extractable: true });
    writeFileSync(
      OIDC_SIGNING_PRIVATE_PATH,
      JSON.stringify(await jose.exportJWK(pair.privateKey)),
    );
    writeFileSync(
      OIDC_SIGNING_PUBLIC_PATH,
      JSON.stringify(await jose.exportJWK(pair.publicKey)),
    );
  }
  return (await jose.importJWK(
    JSON.parse(readFileSync(OIDC_SIGNING_PRIVATE_PATH, "utf8")) as jose.JWK,
    "RS256",
  )) as CryptoKey;
}

/** The published JWK (the stub's `/jwks`). */
export function readPublicJwk(): Record<string, unknown> {
  return {
    ...(JSON.parse(readFileSync(OIDC_SIGNING_PUBLIC_PATH, "utf8")) as Record<
      string,
      unknown
    >),
    kid: "e2e-key",
    alg: "RS256",
    use: "sig",
  };
}

/** The port is persisted so the issuer stays stable across the run. */
export function resolvePort(): number {
  ensureFixtureDir();
  if (existsSync(OIDC_PORT_PATH)) {
    return Number(readFileSync(OIDC_PORT_PATH, "utf8"));
  }
  const port = Number(process.env.E2E_OIDC_PORT ?? 9443);
  writeFileSync(OIDC_PORT_PATH, String(port));
  return port;
}

export function persistPort(port: number): void {
  ensureFixtureDir();
  writeFileSync(OIDC_PORT_PATH, String(port));
}
