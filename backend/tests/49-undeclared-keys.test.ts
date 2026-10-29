/**
 * The global ArkType config drops undeclared keys — unit proof, plus the
 * spread-of-body route (the source-map token create) proving injected row
 * state cannot survive it.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import "../arktype-config";
import { type as arktype } from "arktype";
import { handleFetch as fetch, TEST_ORIGIN } from "./test-helpers";

import { ADMIN_HEADERS } from "./test-helpers";

const baseUrl = TEST_ORIGIN;

describe("Undeclared keys are dropped", () => {
  it("strips client junk from a schema's output (unit)", () => {
    const T = arktype({ name: "string" });
    expect(T({ name: "a", injected: { evil: true }, junk: "x" })).toEqual({
      name: "a",
    });
    // Declared keys keep their morphs (uuid parse, integer parse) unchanged.
    const M = arktype({ id: "string.uuid", limit: "string.integer.parse?" });
    expect(
      M({ id: "5d1b2db5-7a04-4970-a322-df89e1f2eb79", limit: "2", junk: 1 }),
    ).toEqual({ id: "5d1b2db5-7a04-4970-a322-df89e1f2eb79", limit: 2 });
  });

  describe("the spread-of-body create routes", () => {
    let projectId = "";
    let appId = "";

    beforeAll(async () => {
      const projectRes = await (
        await fetch(`${baseUrl}/api/admin/projects`, {
          method: "POST",
          headers: ADMIN_HEADERS,
          body: JSON.stringify({
            name: "Undeclared Keys",
            slug: "undeclared-keys",
          }),
        })
      ).json();
      projectId = (projectRes as { id: string }).id;

      const appRes = await (
        await fetch(`${baseUrl}/api/admin/projects/${projectId}/apps`, {
          method: "POST",
          headers: ADMIN_HEADERS,
          body: JSON.stringify({ name: "web" }),
        })
      ).json();
      appId = (appRes as { id: string }).id;
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
          // undeclared: must not survive the `...body` spread
          id: "attacker-supplied-id",
          tokenHash: "attacker-hash",
          revokedAt: "9999-01-01T00:00:00.000Z",
          lastUsedAt: "9999-01-01T00:00:00.000Z",
        }),
      });
      expect(response.status).toBe(200);

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
