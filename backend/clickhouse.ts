import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { StoredEvent } from "./protocol/events";
import type {
  MetricBreakdownRow,
  MetricSample,
  MetricSeriesPoint,
} from "./protocol/metrics";
import { retryInit } from "./retry";

// ClickHouse is the events store. The API publishes every envelope to
// NATS and ClickHouse ingests it by configuration: a NATS table engine
// (durable pull consumer `clickhouse-events`) feeds a materialized view
// into `sentry_events`, acknowledging a message only after the insert.
// Extracted metric samples travel the same way on `sentry.metrics`
// (`clickhouse-metrics` -> `sentry_metrics`). Reads always use FINAL so
// ReplacingMergeTree collapses redeliveries.

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || "localhost";
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT || "8123";
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "default";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";
// How the *ClickHouse server* reaches NATS (the compose/CI service name by
// default); the backend itself connects through NATS_SERVERS.
const CLICKHOUSE_NATS_URL = process.env.CLICKHOUSE_NATS_URL || "nats:4222";

const NATS_STREAM = "SENTRIES";
const EVENTS_SUBJECT = "sentry.events";
const EVENTS_CONSUMER = "clickhouse-events";
const METRICS_SUBJECT = "sentry.metrics";
const METRICS_CONSUMER = "clickhouse-metrics";

const TABLE = `${CLICKHOUSE_DATABASE}.sentry_events`;
const OLD_TABLE = `${CLICKHOUSE_DATABASE}.sentry_events_old`;
const ENGINE_TABLE = `${CLICKHOUSE_DATABASE}.nats_events`;
const EVENTS_MV = `${CLICKHOUSE_DATABASE}.sentry_events_mv`;
const COLUMNS = "id, projectId, appId, envelopeHeader, envelopeItems, receivedAt";

const METRICS_TABLE = `${CLICKHOUSE_DATABASE}.sentry_metrics`;
const METRICS_ENGINE_TABLE = `${CLICKHOUSE_DATABASE}.nats_metrics`;
const METRICS_MV = `${CLICKHOUSE_DATABASE}.sentry_metrics_mv`;
const METRICS_COLUMNS = "projectId, appId, eventId, metric, value, dimension, receivedAt";

let client: ClickHouseClient | null = null;

export function getClickHouseClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
      request_timeout: 5000,
    });
  }
  return client;
}

export async function closeClickHouse(): Promise<void> {
  const current = client;
  client = null;
  if (current) await current.close();
}

const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS ${TABLE}
  (
    id String,
    projectId String,
    appId String,
    envelopeHeader String,
    envelopeItems String,
    receivedAt DateTime64(3)
  )
  ENGINE = ReplacingMergeTree()
  ORDER BY (projectId, receivedAt, id)
  SETTINGS index_granularity = 8192, fsync_after_insert = 1, fsync_part_directory = 1
`;

const CREATE_ENGINE_TABLE = `
  CREATE TABLE IF NOT EXISTS ${ENGINE_TABLE}
  (
    id String,
    projectId String,
    appId String,
    envelopeHeader String,
    envelopeItems String,
    receivedAt String,
    type String
  )
  ENGINE = NATS
  SETTINGS nats_url = '${CLICKHOUSE_NATS_URL}',
           nats_stream = '${NATS_STREAM}',
           nats_consumer_name = '${EVENTS_CONSUMER}',
           nats_subjects = '${EVENTS_SUBJECT}',
           nats_format = 'JSONEachRow',
           input_format_skip_unknown_fields = 1,
           nats_skip_broken_messages = 10
`;

// A malformed `receivedAt` (junk published to the subject) must be
// skipped — acked and dropped — instead of wedging the engine's insert
// loop with a parse exception that would be redelivered forever. The
// OrNull parse plus the null guard is therefore both the insert
// expression and the views' definition marker.
const RECEIVED_AT_PARSE = "parseDateTime64BestEffortOrNull(receivedAt, 3)";

const CREATE_EVENTS_MV = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS ${EVENTS_MV} TO ${TABLE} AS
  SELECT id, projectId, appId, envelopeHeader, envelopeItems,
         assumeNotNull(parsed_receivedAt) AS receivedAt
  FROM (
    SELECT id, projectId, appId, envelopeHeader, envelopeItems,
           ${RECEIVED_AT_PARSE} AS parsed_receivedAt
    FROM ${ENGINE_TABLE}
    WHERE type != 'clear'
  )
  WHERE parsed_receivedAt IS NOT NULL
`;

// Metric samples: one row per (event, metric, dimension) — measurements
// and sentinels extracted at ingestion (backend/metrics/samples.ts).
const CREATE_METRICS_TABLE = `
  CREATE TABLE IF NOT EXISTS ${METRICS_TABLE}
  (
    projectId String,
    appId String,
    eventId String,
    metric String,
    value Float64,
    dimension String,
    receivedAt DateTime64(3)
  )
  ENGINE = ReplacingMergeTree()
  ORDER BY (projectId, metric, receivedAt, eventId, dimension)
  SETTINGS index_granularity = 8192, fsync_after_insert = 1, fsync_part_directory = 1
`;

const CREATE_METRICS_ENGINE_TABLE = `
  CREATE TABLE IF NOT EXISTS ${METRICS_ENGINE_TABLE}
  (
    projectId String,
    appId String,
    eventId String,
    metric String,
    value Float64,
    dimension String,
    receivedAt String
  )
  ENGINE = NATS
  SETTINGS nats_url = '${CLICKHOUSE_NATS_URL}',
           nats_stream = '${NATS_STREAM}',
           nats_consumer_name = '${METRICS_CONSUMER}',
           nats_subjects = '${METRICS_SUBJECT}',
           nats_format = 'JSONEachRow',
           input_format_skip_unknown_fields = 1,
           nats_skip_broken_messages = 10
`;

const CREATE_METRICS_MV = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS ${METRICS_MV} TO ${METRICS_TABLE} AS
  SELECT projectId, appId, eventId, metric, value, dimension,
         assumeNotNull(parsed_receivedAt) AS receivedAt
  FROM (
    SELECT projectId, appId, eventId, metric, value, dimension,
           ${RECEIVED_AT_PARSE} AS parsed_receivedAt
    FROM ${METRICS_ENGINE_TABLE}
  )
  WHERE parsed_receivedAt IS NOT NULL
`;

// ClickHouse operations are idempotent (reads, IF NOT EXISTS DDL,
// TRUNCATE, dedup-by-id inserts), so a request that dies with a
// connection-level error is retried once: the HTTP agent can reuse a
// socket the server has already closed, which surfaces as
// ECONNRESET / "socket hang up".
const TRANSIENT_CH_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

function isTransientChError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && TRANSIENT_CH_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /socket hang up|connection reset|socket closed/i.test(message);
}

async function withChRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!isTransientChError(err)) throw err;
    console.warn(
      `[ClickHouse] Transient error, retrying: ${err instanceof Error ? err.message : err}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    return operation();
  }
}

async function runCommand(query: string): Promise<void> {
  await withChRetry(() => getClickHouseClient().command({ query }));
}

async function queryRows<T>(
  query: string,
  query_params: Record<string, unknown> = {},
): Promise<T[]> {
  return withChRetry(async () => {
    const result = await getClickHouseClient().query({
      query,
      format: "JSONEachRow",
      query_params,
    });
    return await result.json<T>();
  });
}

// Data-preserving engine migration: the original `sentry_events` was a
// plain MergeTree keyed in seconds precision; the current shape is a
// ReplacingMergeTree keyed by (projectId, receivedAt, id) with
// millisecond timestamps so redelivered messages collapse and events
// inside the same second keep a stable order. Existing rows are copied
// over (deduplicated by id).
async function migrateEventsTable(): Promise<void> {
  const [table] = await queryRows<{ engine: string }>(
    `SELECT engine FROM system.tables WHERE database = {database:String} AND name = 'sentry_events'`,
    { database: CLICKHOUSE_DATABASE },
  );
  if (!table) return;

  const [receivedAt] = await queryRows<{ type: string }>(
    `SELECT type FROM system.columns WHERE database = {database:String} AND table = 'sentry_events' AND name = 'receivedAt'`,
    { database: CLICKHOUSE_DATABASE },
  );
  const current = `${table.engine}/${receivedAt?.type ?? "unknown"}`;
  if (table.engine === "ReplacingMergeTree" && receivedAt?.type === "DateTime64(3)") return;

  console.log(`[ClickHouse] Migrating sentry_events (${current} -> ReplacingMergeTree/DateTime64(3))`);
  // The view references the table being renamed; drop and recreate it.
  await runCommand(`DROP TABLE IF EXISTS ${EVENTS_MV}`);
  await runCommand(`RENAME TABLE ${TABLE} TO ${OLD_TABLE}`);
  await runCommand(CREATE_EVENTS_TABLE);
  await runCommand(`
    INSERT INTO ${TABLE} (id, projectId, appId, envelopeHeader, envelopeItems, receivedAt)
    SELECT id,
           argMax(projectId, receivedAt),
           argMax(appId, receivedAt),
           argMax(envelopeHeader, receivedAt),
           argMax(envelopeItems, receivedAt),
           toDateTime64(max(receivedAt), 3)
    FROM ${OLD_TABLE}
    GROUP BY id
  `);
  await runCommand(`DROP TABLE ${OLD_TABLE}`);
}

// The materialized views are the only writers of the store tables. A view
// is dropped and recreated when its stored definition predates the current
// one — detected by the `RECEIVED_AT_PARSE` marker: views created before
// the null-parse guard (which skips junk messages instead of wedging the
// engine's insert loop) are stale.
async function ensureView(name: string, createSql: string): Promise<void> {
  const [existing] = await queryRows<{ create_table_query: string }>(
    `SELECT create_table_query FROM system.tables WHERE database = {database:String} AND name = {name:String}`,
    { database: CLICKHOUSE_DATABASE, name },
  );
  if (existing && !existing.create_table_query.includes(RECEIVED_AT_PARSE)) {
    await runCommand(`DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.${name}`);
  }
  await runCommand(createSql);
}

// Boot order: NATS (stream + durable pull consumers) first — the engine
// table attaches to `clickhouse-events` by name. Retries, then fails fast.
export async function initClickHouse(): Promise<void> {
  await retryInit("ClickHouse", async () => {
    await runCommand(`CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE}`);
    await migrateEventsTable();
    await runCommand(CREATE_EVENTS_TABLE);
    await runCommand(CREATE_ENGINE_TABLE);
    // The materialized views are the only writers of the store tables; a
    // view is replaced when its stored definition is stale (see
    // `ensureView`).
    await ensureView("sentry_events_mv", CREATE_EVENTS_MV);
    await runCommand(CREATE_METRICS_TABLE);
    await runCommand(CREATE_METRICS_ENGINE_TABLE);
    await ensureView("sentry_metrics_mv", CREATE_METRICS_MV);
    console.log(
      "[ClickHouse] Connected; events and metrics engine tables, views and stores ensured",
    );
  });
}

// ClickHouse DateTime values are written and read as UTC so the API keeps
// ISO timestamps.
function toIsoTimestamp(value: string): string {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

interface ClickHouseEventRow {
  id: string;
  projectId: string;
  appId: string;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
}

function toStoredEvent(row: ClickHouseEventRow): StoredEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    appId: row.appId || null,
    envelopeHeader: row.envelopeHeader,
    envelopeItems: row.envelopeItems,
    receivedAt: toIsoTimestamp(row.receivedAt),
  };
}

function buildEventFilter(options?: {
  projectId?: string;
  appIds?: string[];
}): { where: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const conditions: string[] = [];
  if (options?.projectId) {
    params.projectId = options.projectId;
    conditions.push("projectId = {projectId:String}");
  }
  if (options?.appIds) {
    const placeholders = options.appIds.map((appId, index) => {
      params[`appId${index}`] = appId;
      return `{appId${index}:String}`;
    });
    conditions.push(`appId IN (${placeholders.join(", ")})`);
  }
  return {
    where: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export async function listClickHouseEvents(options?: {
  page?: number;
  limit?: number;
  projectId?: string;
  appIds?: string[];
}): Promise<{
  data: StoredEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 20;
  const offset = (page - 1) * limit;

  // An environment filter resolves to the ids of its apps first;
  // an environment without apps has no events.
  if (options?.appIds && options.appIds.length === 0) {
    return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  }

  const { where, params } = buildEventFilter(options);
  const rows = await queryRows<ClickHouseEventRow>(
    `SELECT ${COLUMNS} FROM ${TABLE} FINAL${where} ORDER BY receivedAt DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    { ...params, limit, offset },
  );
  const countRows = await queryRows<{ total: string | number }>(
    `SELECT count() AS total FROM ${TABLE} FINAL${where}`,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  return {
    data: rows.map(toStoredEvent),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function findClickHouseEvent(id: string): Promise<StoredEvent | undefined> {
  const rows = await queryRows<ClickHouseEventRow>(
    `SELECT ${COLUMNS} FROM ${TABLE} FINAL WHERE id = {id:String} LIMIT 1`,
    { id },
  );
  return rows[0] ? toStoredEvent(rows[0]) : undefined;
}

// Every sample extracted from one event, by metric name — the metric
// counterpart of `findClickHouseEvent` (the series/breakdown queries are
// built on the same table).
export async function listClickHouseMetricSamplesForEvent(
  eventId: string,
): Promise<MetricSample[]> {
  const rows = await queryRows<{
    projectId: string;
    appId: string;
    eventId: string;
    metric: string;
    value: number;
    dimension: string;
    receivedAt: string;
  }>(
    `SELECT ${METRICS_COLUMNS} FROM ${METRICS_TABLE} FINAL WHERE eventId = {eventId:String} ORDER BY metric ASC`,
    { eventId },
  );
  return rows.map((row) => ({
    projectId: row.projectId,
    appId: row.appId,
    eventId: row.eventId,
    metric: row.metric,
    value: Number(row.value),
    dimension: row.dimension,
    receivedAt: toIsoTimestamp(row.receivedAt),
  }));
}

// Shared filter for metric reads: the metric and the time range are
// required; scope narrows by project or by the ids of an environment's
// apps (the routes resolve environment/app filters to app ids first).
export interface MetricReadFilter {
  metric: string;
  projectId?: string;
  appIds?: string[];
  from: string;
  to: string;
}

function buildMetricFilter(options: MetricReadFilter): {
  where: string;
  params: Record<string, unknown>;
} {
  const params: Record<string, unknown> = {
    metric: options.metric,
    from: options.from,
    to: options.to,
  };
  const conditions = [
    "metric = {metric:String}",
    "receivedAt >= parseDateTime64BestEffort({from:String}, 3)",
    "receivedAt <= parseDateTime64BestEffort({to:String}, 3)",
  ];
  if (options.projectId) {
    params.projectId = options.projectId;
    conditions.push("projectId = {projectId:String}");
  }
  if (options.appIds) {
    const placeholders = options.appIds.map((appId, index) => {
      params[`appId${index}`] = appId;
      return `{appId${index}:String}`;
    });
    conditions.push(`appId IN (${placeholders.join(", ")})`);
  }
  return { where: conditions.join(" AND "), params };
}

// Quantiles come out of the raw samples at read time — exact per bucket,
// no rollups and no histogram approximation.
export async function listMetricSeries(
  options: MetricReadFilter & { stepSeconds: number },
): Promise<MetricSeriesPoint[]> {
  // An environment without apps has no samples (an empty `IN ()` is not
  // valid SQL).
  if (options.appIds && options.appIds.length === 0) return [];
  const { where, params } = buildMetricFilter(options);
  const rows = await queryRows<{
    bucketStart: string;
    count: string | number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  }>(
    `SELECT toStartOfInterval(receivedAt, INTERVAL {stepSeconds:UInt32} SECOND) AS bucketStart,
            count() AS count,
            avg(value) AS mean,
            quantile(0.5)(value) AS p50,
            quantile(0.95)(value) AS p95,
            quantile(0.99)(value) AS p99
     FROM ${METRICS_TABLE} FINAL
     WHERE ${where}
     GROUP BY bucketStart
     ORDER BY bucketStart ASC`,
    { ...params, stepSeconds: options.stepSeconds },
  );
  return rows.map((row) => ({
    bucketStart: toIsoTimestamp(row.bucketStart),
    count: Number(row.count),
    mean: Number(row.mean),
    p50: Number(row.p50),
    p95: Number(row.p95),
    p99: Number(row.p99),
  }));
}

export async function listMetricBreakdown(
  options: MetricReadFilter & { limit: number },
): Promise<MetricBreakdownRow[]> {
  if (options.appIds && options.appIds.length === 0) return [];
  const { where, params } = buildMetricFilter(options);
  const rows = await queryRows<{
    dimension: string;
    count: string | number;
    mean: number;
    p50: number;
    p95: number;
  }>(
    `SELECT dimension,
            count() AS count,
            avg(value) AS mean,
            quantile(0.5)(value) AS p50,
            quantile(0.95)(value) AS p95
     FROM ${METRICS_TABLE} FINAL
     WHERE ${where}
     GROUP BY dimension
     ORDER BY count DESC, dimension ASC
     LIMIT {limit:UInt32}`,
    { ...params, limit: options.limit },
  );
  return rows.map((row) => ({
    dimension: row.dimension,
    count: Number(row.count),
    mean: Number(row.mean),
    p50: Number(row.p50),
    p95: Number(row.p95),
  }));
}

// Every event of one app, oldest first — used by the alert sweeper.
export async function listClickHouseEventsForApp(appId: string): Promise<StoredEvent[]> {
  const rows = await queryRows<ClickHouseEventRow>(
    `SELECT ${COLUMNS} FROM ${TABLE} FINAL WHERE appId = {appId:String} ORDER BY receivedAt ASC`,
    { appId },
  );
  return rows.map(toStoredEvent);
}

// Every event of one project, oldest first — used by the release summary.
export async function listClickHouseEventsForProject(
  projectId: string,
): Promise<StoredEvent[]> {
  const rows = await queryRows<ClickHouseEventRow>(
    `SELECT ${COLUMNS} FROM ${TABLE} FINAL WHERE projectId = {projectId:String} ORDER BY receivedAt ASC`,
    { projectId },
  );
  return rows.map(toStoredEvent);
}

// Applied by the side-effects consumer when a `clear` message arrives;
// throws so a failed truncate is redelivered rather than silently lost.
// Metrics derive from events, so they are truncated together.
export async function clearClickHouseEvents(): Promise<void> {
  await runCommand(`TRUNCATE TABLE ${TABLE}`);
  await runCommand(`TRUNCATE TABLE ${METRICS_TABLE}`);
}
