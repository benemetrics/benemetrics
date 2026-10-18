/**
 * Hop 4 — ClickHouse -> metrics API reads.
 *
 * Samples are seeded directly (bypassing ingestion entirely); the metrics
 * API must serve them: a bucketed series with quantiles and the auto
 * step, a dimension breakdown, and the project / app / environment
 * scopes. ClickHouse is the samples store — no ingestion involved.
 */

import { describe, it, expect } from "bun:test";
import { getClickHouseClient } from "../backend/clickhouse";
import {
  ADMIN_HEADERS,
  handleFetch as fetch,
  startTestApp,
  TEST_ORIGIN,
} from "./test-helpers";

const TABLE = `${process.env.CLICKHOUSE_DATABASE || "default"}.sentry_metrics`;

interface SeedSample {
  projectId: string;
  appId: string;
  eventId: string;
  metric: string;
  value: number;
  dimension: string;
  receivedAt: string;
}

async function seedSamples(samples: SeedSample[]): Promise<void> {
  await getClickHouseClient().insert({
    table: TABLE,
    values: samples,
    format: "JSONEachRow",
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}

interface SeriesBody {
  metric: string;
  unit: string;
  points: Array<{
    bucketStart: string;
    count: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  }>;
}

interface BreakdownBody {
  data: Array<{
    dimension: string;
    count: number;
    mean: number;
    p50: number;
    p95: number;
  }>;
}

describe("Hop 4: ClickHouse -> metrics reads", () => {
  it("serves a seeded series bucketed with quantiles", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    // Everything lands in the current minute bucket; the window spans
    // 11 minutes, which the route auto-steps at 1m.
    const base = Math.floor(Date.now() / 60_000) * 60_000;
    const values = [100, 200, 300, 400];
    await seedSamples(
      values.map((value, index) => ({
        projectId: app.projectId,
        appId: app.appId,
        eventId,
        metric: "duration",
        value,
        dimension: "GET /checkout",
        receivedAt: new Date(base + 5_000 + index * 1_000).toISOString(),
      })),
    );
    // A different metric in the same window must not leak into the series.
    await seedSamples([
      {
        projectId: app.projectId,
        appId: app.appId,
        eventId,
        metric: "lcp",
        value: 1234,
        dimension: "GET /checkout",
        receivedAt: new Date(base + 10_000).toISOString(),
      },
    ]);

    const from = new Date(base - 10 * 60_000).toISOString();
    const to = new Date(base + 60_000).toISOString();
    const response = await fetch(
      `${TEST_ORIGIN}/api/admin/metrics/series?metric=duration&projectId=${app.projectId}&from=${from}&to=${to}`,
      { headers: ADMIN_HEADERS },
    );
    expect(response.status).toBe(200);
    const series = (await response.json()) as SeriesBody;

    expect(series.metric).toBe("duration");
    expect(series.unit).toBe("millisecond");
    expect(series.points).toHaveLength(1);
    const point = series.points[0]!;
    expect(Date.parse(point.bucketStart)).toBe(base);
    expect(point.count).toBe(4);
    expect(point.mean).toBe(250);
    expect(point.p50).toBeCloseTo(250);
    expect(point.p95).toBeCloseTo(385);
    expect(point.p99).toBeCloseTo(397);
  }, 20000);

  it("breaks down by dimension and honors the scope filters", async () => {
    const app = await startTestApp();
    const secondApp = (await (
      await fetch(`${TEST_ORIGIN}/api/admin/projects/${app.projectId}/apps`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ name: "Hop 4 Metrics Second App" }),
      })
    ).json()) as { id: string };
    const environments = (await (
      await fetch(`${TEST_ORIGIN}/api/admin/environments?projectId=${app.projectId}`, {
        headers: ADMIN_HEADERS,
      })
    ).json()) as { data: Array<{ id: string; isDefault: boolean }> };
    const defaultEnvironment = environments.data.find(
      (environment) => environment.isDefault,
    )!;

    const base = Math.floor(Date.now() / 60_000) * 60_000;
    const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();
    await seedSamples([
      // Three samples on one dimension (of the app's default environment).
      { projectId: app.projectId, appId: app.appId, eventId: crypto.randomUUID(), metric: "duration", value: 10, dimension: "GET /checkout", receivedAt: at(1_000) },
      { projectId: app.projectId, appId: app.appId, eventId: crypto.randomUUID(), metric: "duration", value: 20, dimension: "GET /checkout", receivedAt: at(2_000) },
      { projectId: app.projectId, appId: app.appId, eventId: crypto.randomUUID(), metric: "duration", value: 30, dimension: "GET /checkout", receivedAt: at(3_000) },
      { projectId: app.projectId, appId: app.appId, eventId: crypto.randomUUID(), metric: "duration", value: 50, dimension: "POST /orders", receivedAt: at(4_000) },
      // A second app in the same project and environment.
      { projectId: app.projectId, appId: secondApp.id, eventId: crypto.randomUUID(), metric: "duration", value: 70, dimension: "GET /cart", receivedAt: at(5_000) },
    ]);

    const from = new Date(base - 10 * 60_000).toISOString();
    const to = new Date(base + 60_000).toISOString();
    const breakdown = async (scope: string, limit?: number) =>
      (await (
        await fetch(
          `${TEST_ORIGIN}/api/admin/metrics/breakdown?metric=duration&${scope}&from=${from}&to=${to}${limit ? `&limit=${limit}` : ""}`,
          { headers: ADMIN_HEADERS },
        )
      ).json()) as BreakdownBody;

    const byProject = await breakdown(`projectId=${app.projectId}`);
    expect(byProject.data.map((row) => row.dimension)).toEqual([
      "GET /checkout",
      "GET /cart",
      "POST /orders",
    ]);
    expect(byProject.data[0]).toMatchObject({
      dimension: "GET /checkout",
      count: 3,
      mean: 20,
      p50: 20,
    });
    expect(byProject.data[0]!.p95).toBeCloseTo(29);

    const limited = await breakdown(`projectId=${app.projectId}`, 1);
    expect(limited.data).toHaveLength(1);
    expect(limited.data[0]!.dimension).toBe("GET /checkout");

    const byApp = await breakdown(`appId=${secondApp.id}`);
    expect(byApp.data).toEqual([
      { dimension: "GET /cart", count: 1, mean: 70, p50: 70, p95: 70 },
    ]);

    // Both apps were created in the project's default environment.
    const byEnvironment = await breakdown(`environmentId=${defaultEnvironment.id}`);
    expect(byEnvironment.data).toHaveLength(3);
    expect(
      byEnvironment.data.reduce((sum, row) => sum + row.count, 0),
    ).toBe(5);
  }, 20000);

  it("rejects an inverted range and unknown apps", async () => {
    const app = await startTestApp();
    const now = Date.now();
    const inverted = await fetch(
      `${TEST_ORIGIN}/api/admin/metrics/series?metric=duration&from=${new Date(now).toISOString()}&to=${new Date(now - 60_000).toISOString()}`,
      { headers: ADMIN_HEADERS },
    );
    expect(inverted.status).toBe(400);

    const unknownApp = await fetch(
      `${TEST_ORIGIN}/api/admin/metrics/series?metric=duration&appId=${crypto.randomUUID()}`,
      { headers: ADMIN_HEADERS },
    );
    expect(unknownApp.status).toBe(404);

    const unauthenticated = await fetch(
      `${TEST_ORIGIN}/api/admin/metrics/series?metric=duration&projectId=${app.projectId}`,
    );
    expect(unauthenticated.status).toBe(401);
  }, 20000);
});
