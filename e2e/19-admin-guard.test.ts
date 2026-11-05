/**
 * E2E: admin auth enforcement boundaries.
 *
 * /api/admin/* and the UI surface (/events) always require the configured
 * credentials: unauthenticated mutations must fail with 401 and leave no
 * side effect. The suite always bootstraps an identity provider (via
 * `e2e/preload.ts`), so admin requests authenticate with the OIDC admin JWT.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { connect } from "node:net";
import { app, ADMIN_HEADERS } from "./test-helpers";

let baseUrl = "";
let server: any;

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

    const list = await fetch(`${baseUrl}/api/admin/projects`, {
      headers: ADMIN_HEADERS,
    });
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
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ name: `Guarded-${Date.now()}` }),
    });
    expect(response.status).toBe(200);
  });

  it("rejects the UI surface without admin credentials", async () => {
    const events = await fetch(`${baseUrl}/events`);
    expect(events.status).toBe(401);

    const unauthenticatedAdmin = await fetch(`${baseUrl}/api/admin/projects`);
    expect(unauthenticatedAdmin.status).toBe(401);
  });

  it("requires admin auth on the UI surface", async () => {
    const events = await fetch(`${baseUrl}/events`);
    expect(events.status).toBe(401);

    // The same surface accepts the OIDC admin JWT.
    const authed = await fetch(`${baseUrl}/events`, { headers: ADMIN_HEADERS });
    expect(authed.status).toBe(200);
  });

  it("keeps the admin JWT valid alongside an identity provider", async () => {
    // The provider adds an identity; the admin JWT still authenticates.
    // Unauthenticated UI requests still fail closed.
    const events = await fetch(`${baseUrl}/events`);
    expect(events.status).toBe(401);

    const withToken = await fetch(`${baseUrl}/events`, {
      headers: ADMIN_HEADERS,
    });
    expect(withToken.status).toBe(200);
    const admin = await fetch(`${baseUrl}/api/admin/projects`, {
      headers: ADMIN_HEADERS,
    });
    expect(admin.status).toBe(200);
  });
});
