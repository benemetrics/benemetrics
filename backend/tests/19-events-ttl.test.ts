/**
 * API Test: Event retention (Settings → Event retention).
 *
 * The retention TTL lives on the ClickHouse events table: the admin reads
 * the live value back from the table definition and changes it. Boot seeds
 * the default only when the table carries no TTL, so an admin change is
 * never overwritten.
 *
 * Runs in-process through app.handle (no listener, no port).
 */

import { describe, it, expect } from "bun:test";
import { handleFetch as fetch, TEST_ORIGIN, ADMIN_TOKEN } from "./test-helpers";

const baseUrl = TEST_ORIGIN;

interface TtlResponse {
  table: string;
  expression: string;
  interval: { amount: number; unit: string } | null;
}

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
  token: string = ADMIN_TOKEN,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: token },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return await fetch(`${baseUrl}${path}`, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("Event retention TTL", () => {
  it("reads the live TTL back from the table definition", async () => {
    const response = await adminRequest(
      "GET",
      "/api/admin/settings/events-ttl",
    );
    expect(response.status).toBe(200);

    const ttl = await json<TtlResponse>(response);
    expect(ttl.table).toBe("sentry_events");
    expect(ttl.interval).not.toBeNull();
    expect(ttl.expression).toContain("toInterval");
  });

  it("changes the retention and reads the new value back", async () => {
    const updated = await adminRequest(
      "PUT",
      "/api/admin/settings/events-ttl",
      {
        amount: 3,
        unit: "month",
      },
    );
    expect(updated.status).toBe(200);
    const after = await json<TtlResponse>(updated);
    expect(after.interval).toEqual({ amount: 3, unit: "month" });

    const read = await adminRequest("GET", "/api/admin/settings/events-ttl");
    expect((await json<TtlResponse>(read)).interval).toEqual({
      amount: 3,
      unit: "month",
    });

    await adminRequest("PUT", "/api/admin/settings/events-ttl", {
      amount: 1,
      unit: "month",
    });
  });

  it("supports the other retention units", async () => {
    const updated = await adminRequest(
      "PUT",
      "/api/admin/settings/events-ttl",
      {
        amount: 2,
        unit: "week",
      },
    );
    expect(updated.status).toBe(200);
    expect((await json<TtlResponse>(updated)).interval).toEqual({
      amount: 2,
      unit: "week",
    });

    await adminRequest("PUT", "/api/admin/settings/events-ttl", {
      amount: 1,
      unit: "month",
    });
  });

  it("removes the retention when the amount is zero", async () => {
    const updated = await adminRequest(
      "PUT",
      "/api/admin/settings/events-ttl",
      {
        amount: 0,
        unit: "month",
      },
    );
    expect(updated.status).toBe(200);
    expect((await json<TtlResponse>(updated)).interval).toBeNull();

    const read = await adminRequest("GET", "/api/admin/settings/events-ttl");
    expect((await json<TtlResponse>(read)).interval).toBeNull();

    await adminRequest("PUT", "/api/admin/settings/events-ttl", {
      amount: 1,
      unit: "month",
    });
  });

  it("rejects an out-of-range retention", async () => {
    const response = await adminRequest(
      "PUT",
      "/api/admin/settings/events-ttl",
      {
        amount: 5000,
        unit: "month",
      },
    );
    expect(response.status).toBe(400);
  });

  it("requires the admin token", async () => {
    const read = await adminRequest(
      "GET",
      "/api/admin/settings/events-ttl",
      undefined,
      "",
    );
    expect(read.status).toBe(401);

    const write = await adminRequest(
      "PUT",
      "/api/admin/settings/events-ttl",
      { amount: 2, unit: "month" },
      "",
    );
    expect(write.status).toBe(401);
  });
});
