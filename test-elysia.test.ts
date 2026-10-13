// Test Elysia test adapter
import { describe, it, expect, beforeAll } from "bun:test";
import app from "./backend/index";

describe("Elysia test", () => {
  it("health check", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });
});