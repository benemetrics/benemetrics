/**
 * E2E: admin auth enforcement boundaries.
 *
 * /api/admin/* and the UI surface (/events) always require the configured
 * credentials: unauthenticated mutations must fail with 401 and leave no
 * side effect. When no OIDC/OAuth2 env is set, ADMIN_TOKEN is the
 * credential; a configured provider adds an identity but never disables
 * the admin token.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { connect } from "node:net";
import app from "../backend/index";

let baseUrl = "";
let server: any;

const adminHeaders = {
  "Content-Type": "application/json",
  Authorization: "API-Key e2e-admin-token",
};

beforeAll(() => {
  app.listen(0);
  server = (app as any).server;
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  delete process.env.OIDC_ISSUER;
  server.stop(true);
});

describe("Admin guard enforcement", () => {
  it("rejects admin mutations without a token", async () => {
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unauth" }),
    });
    expect(response.status).toBe(401);

    const list = await fetch(`${baseUrl}/api/admin/projects`, { headers: adminHeaders });
    const body = (await list.json()) as { data: Array<{ name: string }> };
    expect(body.data.some((project) => project.name === "Unauth")).toBe(false);
  });

  it("rejects an invalid admin token", async () => {
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ name: "WrongToken" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects a multi-byte token of the same length with 401, not 500", async () => {
    // Same character count as the admin token, different byte length: the
    // constant-time compare must not blow up on the length mismatch.
    // A raw socket is the only way to send a lone latin-1 byte in a header.
    const port = (server as any).server?.port ?? (server as any).port;
    const request = Buffer.concat([
      Buffer.from(
        `GET /api/admin/projects HTTP/1.1\r\nHost: localhost\r\nAuthorization: API-Key `,
        "latin1",
      ),
      Buffer.from([0xe9]),
      Buffer.from("e2e-admin-toke\r\nConnection: close\r\n\r\n", "latin1"),
    ]);

    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write(request));
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString("latin1");
      });
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });

    expect(raw).toContain(" 401 ");
    expect(raw).not.toContain(" 500 ");
  });

  it("accepts the configured admin token", async () => {
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: `Guarded-${Date.now()}` }),
    });
    expect(response.status).toBe(200);
  });

  it("rejects the UI surface while no admin credentials are configured", async () => {
    const configured = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    try {
      const events = await fetch(`${baseUrl}/events`);
      expect(events.status).toBe(401);

      const unauthenticatedAdmin = await fetch(`${baseUrl}/api/admin/projects`);
      expect(unauthenticatedAdmin.status).toBe(401);
    } finally {
      if (configured === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = configured;
    }
  });

  it("requires admin auth on the UI surface when ADMIN_TOKEN is configured", async () => {
    const events = await fetch(`${baseUrl}/events`);
    expect(events.status).toBe(401);

    // The same surface accepts the configured admin token.
    const authed = await fetch(`${baseUrl}/events`, { headers: adminHeaders });
    expect(authed.status).toBe(200);
  });

  it("keeps the admin token valid alongside an identity provider", async () => {
    // ADMIN_TOKEN is the master credential: configuring a provider adds an
    // identity, it never disables the token. Unauthenticated UI requests
    // still fail closed.
    process.env.OIDC_ISSUER = "https://idp.example.com";
    try {
      const events = await fetch(`${baseUrl}/events`);
      expect(events.status).toBe(401);

      const withToken = await fetch(`${baseUrl}/events`, { headers: adminHeaders });
      expect(withToken.status).toBe(200);
      const admin = await fetch(`${baseUrl}/api/admin/projects`, { headers: adminHeaders });
      expect(admin.status).toBe(200);
    } finally {
      delete process.env.OIDC_ISSUER;
    }
  });
});
