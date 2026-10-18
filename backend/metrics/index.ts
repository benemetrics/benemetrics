import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { badRequest } from "../errors";
import type { MetricUnit } from "../protocol/metrics";
import { queryMetricBreakdown, queryMetricSeries } from "../metrics-store";

// Metrics API: the reads behind the web-vitals and mobile panels. Samples
// live in ClickHouse (fed from NATS); the routes only resolve the app
// scope from the Postgres control plane and shape the query.

// What the numbers mean per metric — the same taxonomy the ingestion
// extractor writes (backend/metrics/samples.ts). Custom measurements are
// unitless.
const METRIC_UNITS: Record<string, MetricUnit> = {
  lcp: "millisecond",
  inp: "millisecond",
  cls: "ratio",
  fcp: "millisecond",
  ttfb: "millisecond",
  "ttfb.requesttime": "millisecond",
  fp: "millisecond",
  fid: "millisecond",
  app_start_cold: "millisecond",
  app_start_warm: "millisecond",
  time_to_initial_display: "millisecond",
  time_to_full_display: "millisecond",
  stall_total_time: "millisecond",
  stall_longest_time: "millisecond",
  stall_count: "count",
  frames_total: "count",
  frames_slow: "count",
  frames_frozen: "count",
  frames_slow_rate: "ratio",
  frames_frozen_rate: "ratio",
  stall_percentage: "ratio",
  event_count: "count",
  error_count: "count",
  fatal_count: "count",
  duration: "millisecond",
};

function metricUnit(metric: string): MetricUnit {
  return METRIC_UNITS[metric] ?? "none";
}

// Auto bucket size by window: 1m up to 6h, 5m up to 48h, 1h beyond.
const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_STEP_SECONDS = 24 * 60 * 60;
const MAX_BREAKDOWN_LIMIT = 100;
const DEFAULT_BREAKDOWN_LIMIT = 10;

function autoStepSeconds(windowMs: number): number {
  if (windowMs <= 6 * 60 * 60 * 1000) return 60;
  if (windowMs <= 48 * 60 * 60 * 1000) return 300;
  return 3600;
}

// App scope: the most specific filter wins. An environment resolves to the
// apps created inside it — the project/environment/app hierarchy is never
// flattened.
async function resolveAppIds(query: {
  environmentId?: string;
  appId?: string;
}): Promise<string[] | undefined> {
  if (query.appId) {
    await appDAO.findByIdOrThrow(query.appId);
    return [query.appId];
  }
  if (query.environmentId) {
    await environmentDAO.findByIdOrThrow(query.environmentId);
    const apps = await appDAO.listByEnvironment(query.environmentId);
    return apps.map((app) => app.id);
  }
  return undefined;
}

function resolveRange(query: { from?: string; to?: string }): {
  from: string;
  to: string;
  windowMs: number;
} {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_WINDOW_MS);
  if (from.getTime() > to.getTime()) {
    throw badRequest('"from" must not be after "to"');
  }
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    windowMs: to.getTime() - from.getTime(),
  };
}

const readQuery = {
  metric: "string",
  projectId: "string.uuid?",
  environmentId: "string.uuid?",
  appId: "string.uuid?",
  from: "string.date.iso?",
  to: "string.date.iso?",
} as const;

export const metricsRoutes = new Elysia({ prefix: "/metrics" })
  .get(
    "/series",
    async ({ query }) => {
      const { from, to, windowMs } = resolveRange(query);
      const stepSeconds = query.stepSeconds ?? autoStepSeconds(windowMs);
      if (stepSeconds < 1 || stepSeconds > MAX_STEP_SECONDS) {
        throw badRequest(
          `"stepSeconds" must be between 1 and ${MAX_STEP_SECONDS}`,
        );
      }
      const appIds = await resolveAppIds(query);
      const points = await queryMetricSeries(
        { metric: query.metric, projectId: query.projectId, appIds, from, to },
        stepSeconds,
      );
      return { metric: query.metric, unit: metricUnit(query.metric), points };
    },
    { query: arktype({ ...readQuery, stepSeconds: "string.integer.parse?" }) },
  )
  .get(
    "/breakdown",
    async ({ query }) => {
      const { from, to } = resolveRange(query);
      const limit = query.limit ?? DEFAULT_BREAKDOWN_LIMIT;
      if (limit < 1 || limit > MAX_BREAKDOWN_LIMIT) {
        throw badRequest(`"limit" must be between 1 and ${MAX_BREAKDOWN_LIMIT}`);
      }
      const appIds = await resolveAppIds(query);
      const data = await queryMetricBreakdown(
        { metric: query.metric, projectId: query.projectId, appIds, from, to },
        limit,
      );
      return { data };
    },
    { query: arktype({ ...readQuery, limit: "string.integer.parse?" }) },
  );
