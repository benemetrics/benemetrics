/**
 * Core routes.
 *
 * These are not domain endpoints, but they are the first things a client
 * touches, so they get their own in-process coverage:
 *   - GET / -> /ui redirect
 */

import { describe, it, expect } from "bun:test";
import { handleFetch, TEST_ORIGIN } from "./test-helpers";

describe("Core routes", () => {
  it("redirects the root to the admin UI", async () => {
    const response = await handleFetch(`${TEST_ORIGIN}/`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/ui");
  });
});
