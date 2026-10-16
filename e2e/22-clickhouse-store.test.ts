/**
 * E2E Test: optional ClickHouse events store
 *
 * Runs only when CLICKHOUSE_TEST_URL points at a ClickHouse HTTP endpoint:
 *
 *   docker run -d -p 8123:8123 clickhouse/clickhouse-server:24-alpine
 *   CLICKHOUSE_TEST_URL=http://localhost:8123 bun test e2e/22-clickhouse-store.test.ts
 *
 * Verifies the store end to end against the real server: ingested events
 * are pushed to ClickHouse, the events API serves list/get reads from it
 * (including the environment -> appIds filter) and /events/clear
 * truncates it. Skipped (not failed) when no ClickHouse is configured,
 * since it is optional. NOTE: /events/clear empties the whole events
 * table, so point this test at a scratch ClickHouse only.
 */

import { describe, it, expect } from "bun:test";

const clickhouseUrl = process.env.CLICKHOUSE_TEST_URL;

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer e2e-admin-token",
};

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const hexEventId = () => crypto.randomUUID().replaceAll("-", "");

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  let last = await fn();
  while (!predicate(last) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await fn();
  }
  return last;
}

describe("ClickHouse events store", () => {
  it.skipIf(!clickhouseUrl)("pushes stored events and serves the events API from ClickHouse", async () => {
    // CLICKHOUSE_HOST/PORT must be set before the backend modules load, so
    // everything is imported dynamically from here on.
    const parsed = new URL(clickhouseUrl!);
    process.env.CLICKHOUSE_HOST = parsed.hostname;
    process.env.CLICKHOUSE_PORT = parsed.port || "8123";

    const { initClickHouse, closeClickHouse, isClickHouseAvailable, findClickHouseEvent, clearClickHouseEvents } =
      await import("../backend/clickhouse");
    const { startTestServer } = await import("./test-helpers");
    const { storedEventDAO } = await import("db/dao/stored-event");

    await initClickHouse();
    expect(isClickHouseAvailable()).toBe(true);

    // Deterministic content for the count assertions below.
    await clearClickHouseEvents();

    const server = await startTestServer();
    try {
      const publicKey = new URL(server.dsn).username;
      const eventId = hexEventId();
      const response = await fetch(
        `${server.baseUrl}/api/1/store/?sentry_key=${encodeURIComponent(publicKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: eventId, message: `clickhouse ${uniq()}` }),
        },
      );
      expect(response.status).toBe(200);

      // The ingest path pushes the stored event to ClickHouse best-effort.
      const pushed = await waitFor(
        () => findClickHouseEvent(eventId),
        (row) => Boolean(row),
      );
      expect(pushed?.id).toBe(eventId);
      expect(pushed?.appId).toBe(server.appId);

      // Single get reads it back through the API (ClickHouse is available,
      // so the events-store facade serves this from ClickHouse).
      const getResponse = await fetch(`${server.baseUrl}/events/${eventId}`, { headers: ADMIN_HEADERS });
      expect(getResponse.status).toBe(200);

      // Environment scope resolves to the apps created inside it, which
      // exercises the appId IN (...) filter against ClickHouse.
      const environmentsResponse = await fetch(
        `${server.baseUrl}/api/admin/environments?projectId=${server.projectId}`,
        { headers: ADMIN_HEADERS },
      );
      const environments = (await environmentsResponse.json()) as {
        data: Array<{ id: string }>;
      };
      const environmentId = environments.data[0]?.id;
      expect(environmentId).toBeTruthy();

      const envListResponse = await fetch(
        `${server.baseUrl}/events?environmentId=${environmentId}`,
        { headers: ADMIN_HEADERS },
      );
      const envList = (await envListResponse.json()) as {
        data: Array<{ id: string }>;
        pagination: { total: number };
      };
      expect(envList.data.some((item) => item.id === eventId)).toBe(true);

      // Prove the reads come from ClickHouse: drop the Postgres rows and
      // the API must still serve the event from the ClickHouse copy.
      await storedEventDAO.deleteByProject(server.projectId);
      const chBackedGet = await fetch(`${server.baseUrl}/events/${eventId}`, { headers: ADMIN_HEADERS });
      expect(chBackedGet.status).toBe(200);

      const chBackedListResponse = await fetch(
        `${server.baseUrl}/events?projectId=${server.projectId}`,
        { headers: ADMIN_HEADERS },
      );
      const chBackedList = (await chBackedListResponse.json()) as {
        data: Array<{ id: string; receivedAt: string }>;
        pagination: { total: number };
      };
      expect(chBackedList.pagination.total).toBe(1);
      expect(chBackedList.data[0]?.id).toBe(eventId);
      expect(Number.isNaN(Date.parse(chBackedList.data[0]!.receivedAt))).toBe(false);

      // /events/clear truncates the ClickHouse copy too.
      const clearResponse = await fetch(`${server.baseUrl}/events/clear`, { method: "POST", headers: ADMIN_HEADERS });
      expect(clearResponse.status).toBe(200);

      const cleared = await waitFor(
        () => findClickHouseEvent(eventId),
        (row) => !row,
      );
      expect(cleared).toBeUndefined();

      const getAfterClear = await fetch(`${server.baseUrl}/events/${eventId}`, { headers: ADMIN_HEADERS });
      expect(getAfterClear.status).toBe(404);
      const listAfterClearResponse = await fetch(
        `${server.baseUrl}/events?projectId=${server.projectId}`,
        { headers: ADMIN_HEADERS },
      );
      const listAfterClear = (await listAfterClearResponse.json()) as {
        pagination: { total: number };
      };
      expect(listAfterClear.pagination.total).toBe(0);
    } finally {
      server.stop();
      // Reset the shared module state so later test files fall back to
      // Postgres (test files share one process).
      await closeClickHouse();
    }
  });
});
