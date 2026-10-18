import { describe, it, expect } from "bun:test";
import { handleFetch } from "./test-helpers.ts";

describe("Health endpoint", () => {
  it("returns ok", async () => {
    const res = await handleFetch("/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });
});