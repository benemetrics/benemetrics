/**
 * E2E Test: Performance
 *
 * GET /api/admin/metrics/series + /api/admin/metrics/breakdown
 * Runs against a real HTTP listener via startTestServer().
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startTestServer, ADMIN_TOKEN, type TestServer } from "./test-helpers";

let SERVER_URL = "";
let testServer!: TestServer;

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return await fetch(url, options);
}

beforeAll(async () => {
  testServer = await startTestServer();
  SERVER_URL = testServer.baseUrl;
});

afterAll(() => {
  testServer?.stop();
});

describe("Performance", () => {
  it("queries a metric series for the app", async () => {
    const series = await apiRequest(
      "GET",
      `/api/admin/metrics/series?metric=lcp&appId=${encodeURIComponent(testServer.appId)}`,
    );
    expect(series.status).toBe(200);
    const body = (await series.json()) as {
      metric: string;
      unit: string;
      points: unknown[];
    };
    expect(body.metric).toBe("lcp");
    expect(body.unit).toBe("millisecond");
    expect(Array.isArray(body.points)).toBe(true);
  });

  it("queries a metric breakdown for the app", async () => {
    const breakdown = await apiRequest(
      "GET",
      `/api/admin/metrics/breakdown?metric=error_count&appId=${encodeURIComponent(testServer.appId)}`,
    );
    expect(breakdown.status).toBe(200);
    const body = (await breakdown.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
