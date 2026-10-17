/**
 * E2E: admin auth enforcement boundaries.
 *
 * /api/admin/* always requires the configured credentials:
 * unauthenticated mutations must fail with 401 and leave no side
 * effect. The UI surfaces (/events, /storage) are open only while no
 * admin credentials are configured at all. When no OIDC/OAuth2 env is
 * set, ADMIN_TOKEN is the credential; once a provider is configured
 * the admin token is ignored (provider flow stubbed, fails closed).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

let baseUrl = "";
let server: any;

const adminHeaders = {
  "Content-Type": "application/json",
  Authorization: "Bearer e2e-admin-token",
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

  it("accepts the configured admin token", async () => {
    const response = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: `Guarded-${Date.now()}` }),
    });
    expect(response.status).toBe(200);
  });

  it("leaves the UI surfaces open while no admin credentials are configured", async () => {
    const configured = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    try {
      const events = await fetch(`${baseUrl}/events`);
      expect(events.status).toBe(200);

      // Reachable without auth: an unknown object key is a 404, not a 401.
      const storage = await fetch(`${baseUrl}/storage/nonexistent-key.json`);
      expect(storage.status).toBe(404);
    } finally {
      if (configured === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = configured;
    }
  });

  it("requires admin auth on the UI surfaces when ADMIN_TOKEN is configured", async () => {
    const events = await fetch(`${baseUrl}/events`);
    expect(events.status).toBe(401);

    const storage = await fetch(`${baseUrl}/storage/nonexistent-key.json`);
    expect(storage.status).toBe(401);

    // The same surfaces accept the configured admin token.
    const authed = await fetch(`${baseUrl}/events`, { headers: adminHeaders });
    expect(authed.status).toBe(200);
  });

  it("ignores ADMIN_TOKEN on the UI surfaces once OIDC is configured", async () => {
    // ADMIN_TOKEN is configured for the suite (see e2e/preload.ts), but an
    // identity provider takes precedence: the token stops being accepted.
    process.env.OIDC_ISSUER = "https://idp.example.com";
    try {
      const events = await fetch(`${baseUrl}/events`);
      expect(events.status).toBe(401);

      const storage = await fetch(`${baseUrl}/storage/nonexistent-key.json`);
      expect(storage.status).toBe(401);

      // The configured ADMIN_TOKEN is ignored while a provider is set, on
      // the admin API and on the UI surfaces alike (the provider flow is
      // stubbed, so nothing can authenticate yet).
      const withToken = await fetch(`${baseUrl}/events`, { headers: adminHeaders });
      expect(withToken.status).toBe(401);
      const admin = await fetch(`${baseUrl}/api/admin/projects`, { headers: adminHeaders });
      expect(admin.status).toBe(401);
    } finally {
      delete process.env.OIDC_ISSUER;
    }
  });
});
