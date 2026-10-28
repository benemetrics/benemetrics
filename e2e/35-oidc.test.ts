/**
 * E2E: OIDC authentication end to end.
 *
 * The suite's identity provider stub (`e2e/oidc-provider.ts`) serves the
 * discovery document and the JWKS; the backend discovers it at boot and
 * verifies the provider's JWTs with the published key.
 *
 * A verified identity is an id (`<issuer>-<subject>`) — there is no user
 * profile — so a provider JWT only authenticates when a permission grant
 * exists for that id. The tests create one with the admin token.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as jose from "jose";
import { app, ADMIN_TOKEN } from "./test-helpers";
import { identityId, oidcProvider } from "./oidc-provider";
const SUBJECT = "e2e-oidc-user";

let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(async () => {
  app.listen(0);
  server = (app as unknown as { server: ReturnType<typeof Bun.serve> }).server;
  baseUrl = `http://localhost:${server.port}`;

  // The grant for the provider identity.
  const created = await fetch(`${baseUrl}/api/admin/permissions/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
    body: JSON.stringify({
      identityId: identityId(SUBJECT),
      label: "e2e oidc identity",
      environments: [],
      appPrefixes: [],
    }),
  });
  expect(created.status).toBe(200);
});

afterAll(() => {
  server?.stop(true);
});

async function sign(options: {
  audience?: string | string[];
  claims?: Record<string, unknown>;
  issuer?: string;
  expiresIn?: string | null;
  alg?: string;
  key?: CryptoKey;
} = {}): Promise<string> {
  return oidcProvider.sign(options);
}

async function adminStatus(token: string): Promise<number> {
  const response = await fetch(`${baseUrl}/api/admin/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.status;
}

describe("OIDC authentication", () => {
  it("accepts a provider JWT on the admin API", async () => {
    const token = await sign({ claims: { sub: SUBJECT } });
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("accepts a provider JWT on the UI surface", async () => {
    const token = await sign({ claims: { sub: SUBJECT } });
    const response = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
  });

  it("rejects a JWT for another audience", async () => {
    const token = await sign({
      audience: "someone-else",
      claims: { sub: SUBJECT },
    });
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it("rejects a JWT signed by an unknown key", async () => {
    const unknown = await jose.generateKeyPair("RS256", { extractable: true });
    const token = await new jose.SignJWT({ sub: SUBJECT })
      .setProtectedHeader({ alg: "RS256", kid: "e2e-unknown" })
      .setIssuer(oidcProvider.issuer)
      .setAudience(oidcProvider.clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(unknown.privateKey);
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it("rejects missing credentials", async () => {
    const response = await fetch(`${baseUrl}/events`);
    expect(response.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = await sign({
      claims: { sub: SUBJECT },
      expiresIn: "-1m",
    });
    expect(await adminStatus(token)).toBe(401);
  });

  it("maps a token from another issuer to another identity", async () => {
    const token = await sign({
      issuer: "https://other-issuer.example.com",
      claims: { sub: SUBJECT },
    });
    // The issuer is verified against the configured one.
    expect(await adminStatus(token)).toBe(401);
  });

  it("rejects a token from another issuer", async () => {
    const token = await sign({
      issuer: `${oidcProvider.issuer}/`,
      claims: { sub: SUBJECT },
    });
    // The trailing slash is part of the identity id.
    expect(await adminStatus(token)).toBe(401);
  });

  it("rejects a token signed with another algorithm than the published key", async () => {
    const pss = await jose.generateKeyPair("PS256", { extractable: true });
    const token = await new jose.SignJWT({ sub: SUBJECT })
      .setProtectedHeader({ alg: "PS256", kid: "e2e-key" })
      .setIssuer(oidcProvider.issuer)
      .setAudience(oidcProvider.clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(pss.privateKey);
    expect(await adminStatus(token)).toBe(401);
  });

  it("answers an unknown filter name and an out-of-scope name alike", async () => {
    const token = await sign({ claims: { sub: SUBJECT } });

    // An app that exists — the identity's grant is read-nothing, so the
    // app is out of its scope.
    const project = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
      body: JSON.stringify({ name: `OIDC probe ${Date.now()}` }),
    });
    const projectId = ((await project.json()) as { id: string }).id;
    const created = await fetch(`${baseUrl}/api/admin/projects/${projectId}/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
      body: JSON.stringify({ name: "hidden-api" }),
    });
    const appName = ((await created.json()) as { name: string }).name;

    const unknown = await fetch(
      `${baseUrl}/api/admin/issues?query=${encodeURIComponent("app:does-not-exist")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const hidden = await fetch(
      `${baseUrl}/api/admin/issues?query=${encodeURIComponent(`app:${appName}`)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    // The list cannot tell an unknown name from an out-of-scope one.
    expect(unknown.status).toBe(200);
    expect(hidden.status).toBe(200);
    const unknownBody = (await unknown.json()) as { data: unknown[] };
    const hiddenBody = (await hidden.json()) as { data: unknown[] };
    expect(unknownBody.data.length).toBe(0);
    expect(hiddenBody.data.length).toBe(0);
  });

  it("rejects a token whose authorized party is another client", async () => {
    const token = await sign({
      claims: { sub: SUBJECT, azp: "other-client" },
      audience: [oidcProvider.clientId, "other-client"],
    });
    expect(await adminStatus(token)).toBe(401);
  });

  it("rejects a token without an expiry", async () => {
    const token = await sign({ claims: { sub: SUBJECT }, expiresIn: null });
    expect(await adminStatus(token)).toBe(401);
  });
});
