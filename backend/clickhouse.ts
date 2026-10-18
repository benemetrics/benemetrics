import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { StoredEvent } from "./protocol/events";
import { retryInit } from "./retry";

// ClickHouse is the events store. The API publishes every envelope to
// NATS and ClickHouse ingests it by configuration: a NATS table engine
// (durable pull consumer `clickhouse-events`) feeds a materialized view
// into `sentry_events`, acknowledging a message only after the insert.
// Reads always use FINAL so ReplacingMergeTree collapses redeliveries.

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

const TABLE = `${CLICKHOUSE_DATABASE}.sentry_events`;
const OLD_TABLE = `${CLICKHOUSE_DATABASE}.sentry_events_old`;
const ENGINE_TABLE = `${CLICKHOUSE_DATABASE}.nats_events`;
const EVENTS_MV = `${CLICKHOUSE_DATABASE}.sentry_events_mv`;
const COLUMNS = "id, projectId, appId, envelopeHeader, envelopeItems, receivedAt";

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

const CREATE_EVENTS_MV = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS ${EVENTS_MV} TO ${TABLE} AS
  SELECT id, projectId, appId, envelopeHeader, envelopeItems,
         parseDateTime64BestEffort(receivedAt, 3) AS receivedAt
  FROM ${ENGINE_TABLE}
  WHERE type != 'clear'
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

// Boot order: NATS (stream + durable pull consumers) first — the engine
// table attaches to `clickhouse-events` by name. Retries, then fails fast.
export async function initClickHouse(): Promise<void> {
  await retryInit("ClickHouse", async () => {
    await runCommand(`CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE}`);
    await migrateEventsTable();
    await runCommand(CREATE_EVENTS_TABLE);
    await runCommand(CREATE_ENGINE_TABLE);
    // The materialized view is the only writer of the events table: it is
    // replaced when its definition changes (millisecond timestamps).
    const [existingView] = await queryRows<{ create_table_query: string }>(
      `SELECT create_table_query FROM system.tables WHERE database = {database:String} AND name = 'sentry_events_mv'`,
      { database: CLICKHOUSE_DATABASE },
    );
    if (existingView && !existingView.create_table_query.includes("parseDateTime64BestEffort")) {
      await runCommand(`DROP TABLE IF EXISTS ${EVENTS_MV}`);
    }
    await runCommand(CREATE_EVENTS_MV);
    console.log("[ClickHouse] Connected; events engine table, view and store ensured");
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
export async function clearClickHouseEvents(): Promise<void> {
  await runCommand(`TRUNCATE TABLE ${TABLE}`);
}
