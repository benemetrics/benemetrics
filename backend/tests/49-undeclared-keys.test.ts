/**
 * Input hardening — the global ArkType config (`backend/arktype-config.ts`)
 * drops undeclared keys from every schema's output.
 *
 * Two prongs:
 * 1. unit: a plain schema's output carries only the declared keys;
 * 2. endpoint: `...body` spreads (the source-map token create spreads the
 *    validated body straight into the INSERT) cannot carry injected state —
 *    an attacker-supplied `id`/`revokedAt` must not survive.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import "../arktype-config";
import { type as arktype } from "arktype";
import { handleFetch as fetch, TEST_ORIGIN } from "./test-helpers";

const baseUrl = TEST_ORIGIN;

const ADMIN_HEADERS = {
  Authorization: "API-Key e2e-admin-token",
  "Content-Type": "application/json",
};

describe("Undeclared keys are dropped", () => {
  it("strips client junk from a schema's output (unit)", () => {
    const T = arktype({ name: "string" });
    expect(T({ name: "a", injected: { evil: true }, junk: "x" })).toEqual({ name: "a" });
    // Declared keys keep their morphs (uuid parse, integer parse) unchanged.
    const M = arktype({ id: "string.uuid", limit: "string.integer.parse?" });
    expect(
      M({ id: "5d1b2db5-7a04-4970-a322-df89e1f2eb79", limit: "2", junk: 1 }),
    ).toEqual({ id: "5d1b2db5-7a04-4970-a322-df89e1f2eb79", limit: 2 });
  });

  describe("the spread-of-body create routes", () => {
    let projectId = "";
    let appId = "";
    let environmentId = "";

    beforeAll(async () => {
      const projectRes = await (await fetch(`${baseUrl}/api/admin/projects`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ name: "Undeclared Keys", slug: "undeclared-keys" }),
      })).json();
      projectId = (projectRes as { id: string }).id;

      const appRes = await (
        await fetch(`${baseUrl}/api/admin/projects/${projectId}/apps`, {
          method: "POST",
          headers: ADMIN_HEADERS,
          body: JSON.stringify({ name: "web" }),
        })
      ).json();
      appId = (appRes as { id: string }).id;

      const envRes = await (
        await fetch(`${baseUrl}/api/admin/environments`, {
          method: "POST",
          headers: ADMIN_HEADERS,
          body: JSON.stringify({ projectId, name: "Production" }),
        })
      ).json();
      environmentId = (envRes as { id: string }).id;
    });

    afterAll(async () => {
      if (projectId) {
        await fetch(`${baseUrl}/api/admin/projects/${projectId}`, {
          method: "DELETE",
          headers: ADMIN_HEADERS,
        });
      }
    });

    it("cannot inject undeclared row state through the body spread", async () => {
      const response = await fetch(`${baseUrl}/api/admin/source-map-tokens`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({
          name: "hardened",
          projectId,
          appId,
          environmentId,
          // all of these are undeclared and must be dropped, not carried
          // into the INSERT by the `...body` spread
          id: "attacker-supplied-id",
          tokenHash: "attacker-hash",
          revokedAt: "9999-01-01T00:00:00.000Z",
          lastUsedAt: "9999-01-01T00:00:00.000Z",
        }),
      });
      expect(response.status).toBe(200);

      // The response is `{ ...record, token }`, so the injected column
      // values would end up top-level if the spread carried them.
      const created = (await response.json()) as {
        id: string;
        revokedAt: string | null;
        lastUsedAt: string | null;
        tokenHash?: string;
      };
      expect(created.id).not.toBe("attacker-supplied-id");
      expect(created.revokedAt).toBeNull();
      expect(created.lastUsedAt).toBeNull();
      expect("tokenHash" in created).toBe(false);
    });
  });
});
