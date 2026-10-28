import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseDialect, SQLQuery } from "waddler";
import { sql, waddler, type ClickHouseSQL } from "waddler/clickhouse";
import type { StoredEvent } from "./protocol/events";
import type {
  MetricBreakdownRow,
  MetricSample,
  MetricSeriesPoint,
} from "./protocol/metrics";

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || "localhost";
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT || "8123";
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "default";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";
const CLICKHOUSE_NATS_URL = process.env.CLICKHOUSE_NATS_URL || "nats:4222";
// The engine connection is the `INTERNAL` config user of the broker.
const CLICKHOUSE_NATS_USER = process.env.CLICKHOUSE_NATS_USER || "sentries-internal";
const CLICKHOUSE_NATS_PASSWORD = process.env.CLICKHOUSE_NATS_PASSWORD || "sentries-dev-internal-pass";

const NATS_STREAM = "SENTRIES";
const EVENTS_SUBJECT = "sentry.events.*";
const EVENTS_CONSUMER = "clickhouse-events";
const METRICS_SUBJECT = "sentry.metrics";
const METRICS_CONSUMER = "clickhouse-metrics";

// A statement or fragment built with the standalone `sql` builder and
// executed through `runCommand` / `queryRows` below.
type ChQuery = SQLQuery<ClickHouseDialect>;

// Waddler's ClickHouse driver exposes the `sql` template only — it has no
// table DSL — so the schema is declared once here and drives the DDL, the
// SELECT lists and the INSERT bindings. Column order is significant: it is
// the order of the rows passed to `sql.values`.
//
// The optional third element is the type the value binds as when the
// declared type cannot parse the value as sent: `receivedAt` is an ISO
// string (with `T`/`Z`) that ClickHouse rejects as a DateTime64 parameter,
// so it is bound as a String and cast by the target column.
type ChColumn = readonly [name: string, type: string, bind?: string];

const EVENTS_COLUMNS: readonly ChColumn[] = [
  ["id", "String"],
  ["projectId", "String"],
  ["appId", "String"],
  ["envelopeHeader", "String"],
  ["envelopeItems", "String"],
  ["receivedAt", "DateTime64(3)", "String"],
];

// The engine table receives JSONEachRow, so the timestamp arrives as a
// string; `type` distinguishes envelope from store messages.
const EVENTS_ENGINE_COLUMNS: readonly ChColumn[] = [
  ["id", "String"],
  ["projectId", "String"],
  ["appId", "String"],
  ["envelopeHeader", "String"],
  ["envelopeItems", "String"],
  ["issueEvents", "String"],
  ["receivedAt", "String"],
  ["type", "String"],
];

// The derived issue index: one row per event item, so the drill-down and
// the stats read from ClickHouse instead of re-fingerprinting the events.
const ISSUE_EVENTS_COLUMNS: readonly ChColumn[] = [
  ["messageId", "String"],
  ["eventId", "String"],
  ["projectId", "String"],
  ["appId", "String"],
  ["fingerprint", "String"],
  ["title", "String"],
  ["level", "String"],
  ["type", "String"],
  ["release", "String"],
  ["environment", "String"],
  ["user", "String"],
  // The occurrence's tags; a JSON object as a string.
  ["tags", "String"],
  ["receivedAt", "DateTime64(3)"],
];

const METRICS_COLUMNS: readonly ChColumn[] = [
  ["projectId", "String"],
  ["appId", "String"],
  ["eventId", "String"],
  ["metric", "String"],
  ["value", "Float64"],
  ["dimension", "String"],
  // The event's tags as a JSON string; the rule filters match on them.
  ["tags", "String"],
  ["receivedAt", "DateTime64(3)", "String"],
];

const METRICS_ENGINE_COLUMNS: readonly ChColumn[] = [
  ["projectId", "String"],
  ["appId", "String"],
  ["eventId", "String"],
  ["metric", "String"],
  ["value", "Float64"],
  ["dimension", "String"],
  ["tags", "String"],
  ["receivedAt", "String"],
];

// Every table and view lives inside `CLICKHOUSE_DATABASE`; the identifier
// keeps the database qualification in one place.
const chTable = (name: string) =>
  sql.identifier({ schema: CLICKHOUSE_DATABASE, table: name });

const EVENTS_TABLE = chTable("sentry_events");
const EVENTS_OLD_TABLE = chTable("sentry_events_old");
const EVENTS_ENGINE_TABLE = chTable("nats_events");
const EVENTS_VIEW = chTable("sentry_events_mv");
const ISSUE_EVENTS_TABLE = chTable("sentry_issue_events");
const ISSUE_EVENTS_VIEW = chTable("sentry_issue_events_mv");
const METRICS_TABLE = chTable("sentry_metrics");
const METRICS_ENGINE_TABLE = chTable("nats_metrics");
const METRICS_VIEW = chTable("sentry_metrics_mv");

// Waddler handle: created on first use and dropped on close so test files
// can open and close the store repeatedly.
let client: ClickHouseClient | null = null;
let chSql: ClickHouseSQL | null = null;

function getChSql(): ClickHouseSQL {
  if (!chSql) {
    client = createClient({
      url: `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
      request_timeout: 5000,
    });
    chSql = waddler({ client });
  }
  return chSql;
}

export async function closeClickHouse(): Promise<void> {
  const current = client;
  client = null;
  chSql = null;
  if (current) await current.close();
}

// Executes a statement without a result set (DDL, INSERT, TRUNCATE).
async function runCommand(statement: ChQuery): Promise<void> {
  await withChRetry(async () => {
    await getChSql()`${statement}`.command();
  });
}

// Executes a SELECT and returns its rows in the object row mode.
async function queryRows<T>(statement: ChQuery): Promise<T[]> {
  return await withChRetry(async () =>
    (await getChSql()<T>`${statement}`.query()) as T[],
  );
}

// Waddler has no `sql.join`, so fragments are appended by hand.
function joinChunks(chunks: readonly ChQuery[], separator: ChQuery): ChQuery {
  const [first, ...rest] = chunks;
  if (!first) return sql``;
  for (const chunk of rest) {
    first.append(separator);
    first.append(chunk);
  }
  return first;
}

// `` `id`, `projectId`, … `` — the SELECT list and the INSERT target.
function columnList(columns: readonly ChColumn[]): ChQuery {
  return joinChunks(
    columns.map(([name]) => sql`${sql.identifier(name)}`),
    sql`, `,
  );
}

// `` `id` String, `projectId` String, … `` — the CREATE TABLE body.
function columnDefinitions(columns: readonly ChColumn[]): ChQuery {
  return joinChunks(
    columns.map(([name, type]) => sql`${sql.identifier(name)} ${sql.raw(type)}`),
    sql`, `,
  );
}

// Bound explicitly in `sql.values`; the binding type is the declared type
// unless the schema overrides it.
function columnTypes(columns: readonly ChColumn[]): string[] {
  return columns.map(([, type, bind]) => bind ?? type);
}

// The views select every payload column; the timestamp is recomputed from
// the parsed engine value instead.
function payloadList(columns: readonly ChColumn[]): ChQuery {
  return columnList(columns.filter(([name]) => name !== "receivedAt"));
}

// A malformed `receivedAt` (junk published to the subject) must be
// skipped — acked and dropped — instead of wedging the engine's insert
// loop with a parse exception that would be redelivered forever. The
// OrNull parse plus the null guard is therefore both the insert
// expression and the views' definition marker.
const RECEIVED_AT_PARSE = "parseDateTime64BestEffortOrNull(receivedAt, 3)";

// ISO window bounds are parsed at millisecond precision by ClickHouse.
const atOrAfter = (iso: string) =>
  sql`receivedAt >= parseDateTime64BestEffort(${iso}, 3)`;
const atOrBefore = (iso: string) =>
  sql`receivedAt <= parseDateTime64BestEffort(${iso}, 3)`;

export type TtlUnit = "day" | "week" | "month" | "year";

export const DEFAULT_EVENTS_TTL: { amount: number; unit: TtlUnit } = {
  amount: 1,
  unit: "month",
};

const INTERVAL_FUNCTIONS: Record<TtlUnit, string> = {
  day: "toIntervalDay",
  week: "toIntervalWeek",
  month: "toIntervalMonth",
  year: "toIntervalYear",
};

export interface EventsTtl {
  table: string;
  expression: string;
  interval: { amount: number; unit: TtlUnit } | null;
}

function ttlExpression(amount: number, unit: TtlUnit): string {
  return `toDateTime(receivedAt) + ${INTERVAL_FUNCTIONS[unit]}(${amount})`;
}

function createEventsTable(
  ttl: { amount: number; unit: TtlUnit } = DEFAULT_EVENTS_TTL,
): ChQuery {
  return sql`
    CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE}
    (${columnDefinitions(EVENTS_COLUMNS)})
    ENGINE = ReplacingMergeTree()
    ORDER BY (projectId, receivedAt, id)
    ${ttl.amount > 0 ? sql.raw(`TTL ${ttlExpression(ttl.amount, ttl.unit)}`) : sql``}
    SETTINGS index_granularity = 8192, fsync_after_insert = 1, fsync_part_directory = 1
  `;
}

// Both engine tables attach to the stream by configuration; only the
// consumer and the subject differ.
function natsEngine(consumer: string, subject: string): ChQuery {
  return sql`
    ENGINE = NATS
    SETTINGS nats_url = ${CLICKHOUSE_NATS_URL},
             nats_username = ${CLICKHOUSE_NATS_USER},
             nats_password = ${CLICKHOUSE_NATS_PASSWORD},
             nats_stream = ${NATS_STREAM},
             nats_consumer_name = ${consumer},
             nats_subjects = ${subject},
             nats_format = 'JSONEachRow',
             input_format_skip_unknown_fields = 1,
             nats_skip_broken_messages = 10
  `;
}

function createEventsEngineTable(): ChQuery {
  return sql`
    CREATE TABLE IF NOT EXISTS ${EVENTS_ENGINE_TABLE}
    (${columnDefinitions(EVENTS_ENGINE_COLUMNS)})
    ${natsEngine(EVENTS_CONSUMER, EVENTS_SUBJECT)}
  `;
}

function createEventsView(): ChQuery {
  return sql`
    CREATE MATERIALIZED VIEW IF NOT EXISTS ${EVENTS_VIEW} TO ${EVENTS_TABLE} AS
    SELECT ${payloadList(EVENTS_COLUMNS)},
           assumeNotNull(parsed_receivedAt) AS receivedAt
    FROM (
      SELECT ${payloadList(EVENTS_COLUMNS)},
             ${sql.raw(RECEIVED_AT_PARSE)} AS parsed_receivedAt
      FROM ${EVENTS_ENGINE_TABLE}
    )
    WHERE parsed_receivedAt IS NOT NULL
  `;
}

function createIssueEventsTable(
  ttl: { amount: number; unit: TtlUnit } = DEFAULT_EVENTS_TTL,
): ChQuery {
  return sql`
    CREATE TABLE IF NOT EXISTS ${ISSUE_EVENTS_TABLE}
    (${columnDefinitions(ISSUE_EVENTS_COLUMNS)})
    ENGINE = ReplacingMergeTree()
    ORDER BY (appId, fingerprint, receivedAt, eventId)
    ${ttl.amount > 0 ? sql.raw(`TTL ${ttlExpression(ttl.amount, ttl.unit)}`) : sql``}
    SETTINGS index_granularity = 8192
  `;
}

// The digests ride the event message as JSON text; the view expands them
// into one row per event item. A message without digests (or with a
// non-array one) contributes no rows.
function createIssueEventsView(): ChQuery {
  return sql`
    CREATE MATERIALIZED VIEW IF NOT EXISTS ${ISSUE_EVENTS_VIEW} TO ${ISSUE_EVENTS_TABLE} AS
    SELECT
      id AS messageId,
      JSONExtractString(digest, 'eventId') AS eventId,
      projectId,
      appId,
      JSONExtractString(digest, 'fingerprint') AS fingerprint,
      JSONExtractString(digest, 'title') AS title,
      JSONExtractString(digest, 'level') AS level,
      JSONExtractString(digest, 'type') AS type,
      JSONExtractString(digest, 'release') AS release,
      JSONExtractString(digest, 'environment') AS environment,
      JSONExtractString(digest, 'user') AS user,
      JSONExtractRaw(digest, 'tags') AS tags,
      assumeNotNull(parsed_receivedAt) AS receivedAt
    FROM (
      SELECT id, projectId, appId,
             ${sql.raw(RECEIVED_AT_PARSE)} AS parsed_receivedAt,
             arrayJoin(
               if(startsWith(issueEvents, '['), JSONExtractArrayRaw(issueEvents), [])
             ) AS digest
      FROM ${EVENTS_ENGINE_TABLE}
    )
    WHERE parsed_receivedAt IS NOT NULL
  `;
}

function createMetricsTable(
  ttl: { amount: number; unit: TtlUnit } = DEFAULT_EVENTS_TTL,
): ChQuery {
  return sql`
    CREATE TABLE IF NOT EXISTS ${METRICS_TABLE}
    (${columnDefinitions(METRICS_COLUMNS)})
    ENGINE = ReplacingMergeTree()
    ORDER BY (projectId, metric, receivedAt, eventId, dimension)
    ${ttl.amount > 0 ? sql.raw(`TTL ${ttlExpression(ttl.amount, ttl.unit)}`) : sql``}
    SETTINGS index_granularity = 8192, fsync_after_insert = 1, fsync_part_directory = 1
  `;
}

function createMetricsEngineTable(): ChQuery {
  return sql`
    CREATE TABLE IF NOT EXISTS ${METRICS_ENGINE_TABLE}
    (${columnDefinitions(METRICS_ENGINE_COLUMNS)})
    ${natsEngine(METRICS_CONSUMER, METRICS_SUBJECT)}
  `;
}

function createMetricsView(): ChQuery {
  return sql`
    CREATE MATERIALIZED VIEW IF NOT EXISTS ${METRICS_VIEW} TO ${METRICS_TABLE} AS
    SELECT ${payloadList(METRICS_COLUMNS)},
           assumeNotNull(parsed_receivedAt) AS receivedAt
    FROM (
      SELECT ${payloadList(METRICS_COLUMNS)},
             ${sql.raw(RECEIVED_AT_PARSE)} AS parsed_receivedAt
      FROM ${METRICS_ENGINE_TABLE}
    )
    WHERE parsed_receivedAt IS NOT NULL
  `;
}

const TRANSIENT_CH_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

// Waddler wraps driver failures, so the original error — with its socket
// code and message — is inspected through the `cause` chain.
function isTransientChError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && TRANSIENT_CH_CODES.has(code)) return true;
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (cause !== undefined && cause !== err) {
    if (isTransientChError(cause)) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /socket hang up|connection reset|socket closed/i.test(message);
}

// ClickHouse operations are idempotent (reads, IF NOT EXISTS DDL,
// TRUNCATE, dedup-by-id inserts), so a request that dies with a
// connection-level error is retried: the HTTP agent can reuse a
// socket the server has already closed, which surfaces as
// ECONNRESET / "socket hang up".
const CH_RETRY_ATTEMPTS = Number(process.env.CH_CLIKE_RETRY_ATTEMPTS) || 3;
const CH_RETRY_DELAY_MS = Number(process.env.CH_CLIKE_RETRY_DELAY_MS) || 200;

// The circuit breaker: repeated transient failures mean ClickHouse is down,
// and hammering it does not help. The circuit opens and the queries fail
// fast until it closes again.
const CH_CIRCUIT_FAILURES = Number(process.env.CH_CLIKE_CIRCUIT_FAILURES) || 5;
const CH_CIRCUIT_COOLDOWN_MS =
  Number(process.env.CH_CLIKE_CIRCUIT_COOLDOWN_MS) || 30_000;

export class ClickHouseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClickHouseUnavailableError";
  }
}

let consecutiveFailures = 0;
let circuitOpenedAt = 0;

/** Whether the circuit is open — the queries would fail fast. */
export function isClickHouseCircuitOpen(): boolean {
  return circuitIsOpen();
}

function circuitIsOpen(): boolean {
  if (consecutiveFailures < CH_CIRCUIT_FAILURES) return false;
  if (Date.now() - circuitOpenedAt >= CH_CIRCUIT_COOLDOWN_MS) {
    // Half-open: the next request decides whether the circuit closes.
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

async function withChRetry<T>(operation: () => Promise<T>): Promise<T> {
  if (circuitIsOpen()) {
    throw new ClickHouseUnavailableError(
      "the ClickHouse circuit is open; the queries fail fast until it closes",
    );
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= CH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await operation();
      consecutiveFailures = 0;
      return result;
    } catch (err) {
      if (!isTransientChError(err)) throw err;
      lastError = err;
      if (attempt >= CH_RETRY_ATTEMPTS) break;
      console.warn(
        `[ClickHouse] Transient error, retrying (${attempt}/${CH_RETRY_ATTEMPTS}): ${describeError(err)}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, CH_RETRY_DELAY_MS * attempt),
      );
    }
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= CH_CIRCUIT_FAILURES) {
    circuitOpenedAt = Date.now();
    console.error(
      "[ClickHouse] the circuit is open — the queries fail fast until it closes",
    );
  }
  throw lastError;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Boot-time init retries: ClickHouse is required, so a slow start is
// retried a few times and a persistent failure is fatal — the server
// never runs half-wired.
const INIT_ATTEMPTS = Number(process.env.INIT_RETRY_ATTEMPTS) || 5;
const INIT_RETRY_DELAY_MS = Number(process.env.INIT_RETRY_DELAY_MS) || 1000;

async function retryInit(run: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      if (attempt >= INIT_ATTEMPTS) throw err;
      console.error(
        `[init] ClickHouse attempt ${attempt}/${INIT_ATTEMPTS} failed: ${describeError(err)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAY_MS));
    }
  }
}

// Data-preserving engine migration: the original `sentry_events` was a
// plain MergeTree keyed in seconds precision; the current shape is a
// ReplacingMergeTree keyed by (projectId, receivedAt, id) with
// millisecond timestamps so redelivered messages collapse and events
// inside the same second keep a stable order. Existing rows are copied
// over (deduplicated by id).
// The digest column joined the engine table after it was created. A NATS
// table cannot be altered, so it is recreated — the rows live in the
// stream, so the durable's position is what carries over.
async function ensureEventsEngineColumns(): Promise<void> {
  const [column] = await queryRows<{ name: string }>(
    sql`
      SELECT name FROM system.columns
      WHERE database = ${CLICKHOUSE_DATABASE} AND table = 'nats_events' AND name = 'issueEvents'
    `,
  );
  if (column) return;
  console.log("[ClickHouse] Recreating nats_events with the issueEvents column");
  await runCommand(sql`DROP TABLE IF EXISTS ${EVENTS_ENGINE_TABLE}`);
  await runCommand(createEventsEngineTable());
}

// The metrics' store table gains the tags column; the engine table is
// rebuilt when it predates the column (the stream keeps the data).
// The issue index carries the occurrence's tags; the column and the view
// are added to an existing installation.
async function ensureIssueEventsColumns(): Promise<void> {
  const [column] = await queryRows<{ name: string }>(
    sql`
      SELECT name FROM system.columns
      WHERE database = ${CLICKHOUSE_DATABASE} AND table = 'sentry_issue_events' AND name = 'tags'
    `,
  );
  if (!column) {
    console.log("[ClickHouse] Adding the tags column to sentry_issue_events");
    await runCommand(sql`ALTER TABLE ${ISSUE_EVENTS_TABLE} ADD COLUMN tags String`);
  }
  const [view] = await queryRows<{ create_table_query: string }>(
    sql`
      SELECT create_table_query FROM system.tables
      WHERE database = ${CLICKHOUSE_DATABASE} AND name = 'sentry_issue_events_mv'
    `,
  );
  if (view && !view.create_table_query.includes("JSONExtractRaw(digest, 'tags')")) {
    console.log("[ClickHouse] Recreating the issue events view with the tags column");
    await runCommand(sql`DROP TABLE IF EXISTS ${ISSUE_EVENTS_VIEW}`);
  }
  await runCommand(createIssueEventsView());
}

async function ensureMetricsColumns(): Promise<void> {
  const [column] = await queryRows<{ name: string }>(
    sql`
      SELECT name FROM system.columns
      WHERE database = ${CLICKHOUSE_DATABASE} AND table = 'sentry_metrics' AND name = 'tags'
    `,
  );
  if (column) return;
  console.log("[ClickHouse] Adding the tags column to sentry_metrics");
  await runCommand(sql`ALTER TABLE ${METRICS_TABLE} ADD COLUMN tags String`);
}

async function ensureMetricsEngineColumns(): Promise<void> {
  const [column] = await queryRows<{ name: string }>(
    sql`
      SELECT name FROM system.columns
      WHERE database = ${CLICKHOUSE_DATABASE} AND table = 'nats_metrics' AND name = 'tags'
    `,
  );
  if (column) return;
  console.log("[ClickHouse] Recreating nats_metrics with the tags column");
  await runCommand(sql`DROP TABLE IF EXISTS ${METRICS_ENGINE_TABLE}`);
  await runCommand(createMetricsEngineTable());
}

// The metrics' view selects the payload's columns; it is recreated when it
// predates the tags column.
async function ensureMetricsView(): Promise<void> {
  const [existing] = await queryRows<{ create_table_query: string }>(
    sql`
      SELECT create_table_query FROM system.tables
      WHERE database = ${CLICKHOUSE_DATABASE} AND name = 'sentry_metrics_mv'
    `,
  );
  if (existing && !existing.create_table_query.includes("tags")) {
    await runCommand(sql`DROP TABLE IF EXISTS ${chTable("sentry_metrics_mv")}`);
  }
  await runCommand(createMetricsView());
}

async function migrateEventsTable(): Promise<void> {
  const [table] = await queryRows<{ engine: string }>(
    sql`
      SELECT engine FROM system.tables
      WHERE database = ${CLICKHOUSE_DATABASE} AND name = 'sentry_events'
    `,
  );
  if (!table) return;

  const [receivedAt] = await queryRows<{ type: string }>(
    sql`
      SELECT type FROM system.columns
      WHERE database = ${CLICKHOUSE_DATABASE} AND table = 'sentry_events' AND name = 'receivedAt'
    `,
  );
  const current = `${table.engine}/${receivedAt?.type ?? "unknown"}`;
  if (table.engine === "ReplacingMergeTree" && receivedAt?.type === "DateTime64(3)") return;

  // The rebuilt table must keep the retention an admin configured.
  const previousTtl = await readEventsTtl();
  const previousInterval = previousTtl.interval ?? DEFAULT_EVENTS_TTL;

  console.log(`[ClickHouse] Migrating sentry_events (${current} -> ReplacingMergeTree/DateTime64(3))`);
  await runCommand(sql`DROP TABLE IF EXISTS ${EVENTS_VIEW}`);
  await runCommand(sql`RENAME TABLE ${EVENTS_TABLE} TO ${EVENTS_OLD_TABLE}`);
  await runCommand(createEventsTable(previousInterval));
  await runCommand(sql`
    INSERT INTO ${EVENTS_TABLE} (${columnList(EVENTS_COLUMNS)})
    SELECT id,
           argMax(projectId, receivedAt),
           argMax(appId, receivedAt),
           argMax(envelopeHeader, receivedAt),
           argMax(envelopeItems, receivedAt),
           toDateTime64(max(receivedAt), 3)
    FROM ${EVENTS_OLD_TABLE}
    GROUP BY id
  `);
  await runCommand(sql`DROP TABLE ${EVENTS_OLD_TABLE}`);
  if (previousTtl.interval) {
    await setEventsTtl(previousTtl.interval.amount, previousTtl.interval.unit);
  }
}

// The materialized views are the only writers of the store tables. A view
// is dropped and recreated when its stored definition predates the current
// one — detected by the `RECEIVED_AT_PARSE` marker: views created before
// the null-parse guard (which skips junk messages instead of wedging the
// engine's insert loop) are stale.
async function ensureView(name: string, createView: ChQuery): Promise<void> {
  const [existing] = await queryRows<{ create_table_query: string }>(
    sql`
      SELECT create_table_query FROM system.tables
      WHERE database = ${CLICKHOUSE_DATABASE} AND name = ${name}
    `,
  );
  if (existing && !existing.create_table_query.includes(RECEIVED_AT_PARSE)) {
    await runCommand(sql`DROP TABLE IF EXISTS ${chTable(name)}`);
  }
  await runCommand(createView);
}

export async function readEventsTtl(): Promise<EventsTtl> {
  const [table] = await queryRows<{ create_table_query: string }>(
    sql`
      SELECT create_table_query FROM system.tables
      WHERE database = ${CLICKHOUSE_DATABASE} AND name = 'sentry_events'
    `,
  );
  if (!table) return { table: "sentry_events", expression: "", interval: null };
  const match = /\bTTL\s+(.+?)(?=\s+SETTINGS\b|\s*$)/is.exec(
    table.create_table_query,
  );
  if (!match) return { table: "sentry_events", expression: "", interval: null };
  const expression = match[1]!.trim();
  const interval = /toInterval(Month|Week|Day|Year)\((\d+)\)/i.exec(expression);
  return {
    table: "sentry_events",
    expression,
    interval: interval
      ? {
          amount: Number(interval[2]),
          unit: interval[1]!.toLowerCase() as TtlUnit,
        }
      : null,
  };
}

// The events and the metric samples share one lifetime: a retention that
// dropped the events but kept their counters would make the volume metrics
// disagree with the store.
export async function setEventsTtl(
  amount: number,
  unit: TtlUnit = DEFAULT_EVENTS_TTL.unit,
): Promise<EventsTtl> {
  if (amount <= 0) {
    await runCommand(sql`ALTER TABLE ${EVENTS_TABLE} REMOVE TTL`);
    await runCommand(sql`ALTER TABLE ${METRICS_TABLE} REMOVE TTL`);
    await runCommand(sql`ALTER TABLE ${ISSUE_EVENTS_TABLE} REMOVE TTL`);
    return readEventsTtl();
  }
  const expression = ttlExpression(amount, unit);
  await runCommand(sql`ALTER TABLE ${EVENTS_TABLE} MODIFY TTL ${sql.raw(expression)}`);
  await runCommand(sql`ALTER TABLE ${METRICS_TABLE} MODIFY TTL ${sql.raw(expression)}`);
  await runCommand(sql`ALTER TABLE ${ISSUE_EVENTS_TABLE} MODIFY TTL ${sql.raw(expression)}`);
  return readEventsTtl();
}

// Boot seeds the default only when the table carries no TTL.
async function ensureEventsTtl(): Promise<void> {
  const existing = await readEventsTtl();
  if (existing.interval) return;
  await setEventsTtl(DEFAULT_EVENTS_TTL.amount, DEFAULT_EVENTS_TTL.unit);
}

// A NATS table cannot be altered: when an existing engine table predates
// the engine credentials, it is recreated (the rows live in the stream).
async function ensureEngineAuthSettings(): Promise<void> {
  for (const table of ["nats_events", "nats_metrics"]) {
    const [row] = await queryRows<{ create_table_query: string }>(
      sql`
        SELECT create_table_query FROM system.tables
        WHERE database = ${CLICKHOUSE_DATABASE} AND name = ${table}
      `,
    );
    if (row && !row.create_table_query.includes("nats_username")) {
      console.log(`[ClickHouse] Recreating ${table} with the engine auth settings`);
      await runCommand(sql`DROP TABLE IF EXISTS ${sql.identifier(CLICKHOUSE_DATABASE)}.${sql.identifier(table)}`);
    }
  }
}

// Boot order: NATS (stream + durable pull consumers) first — the engine
// table attaches to `clickhouse-events` by name. Retries, then fails fast.
export async function initClickHouse(): Promise<void> {
  await retryInit(async () => {
    await runCommand(sql`CREATE DATABASE IF NOT EXISTS ${sql.identifier(CLICKHOUSE_DATABASE)}`);
    await migrateEventsTable();
    await runCommand(createEventsTable());
    await ensureEngineAuthSettings();
    await runCommand(createEventsEngineTable());
    await ensureEventsEngineColumns();
    await ensureView("sentry_events_mv", createEventsView());
    await runCommand(createIssueEventsTable());
    await ensureIssueEventsColumns();
    await runCommand(createMetricsTable());
    await ensureMetricsColumns();
    await runCommand(createMetricsEngineTable());
    await ensureMetricsEngineColumns();
    await ensureMetricsView();
    await ensureEventsTtl();
    console.log(
      "[ClickHouse] Connected; events and metrics engine tables, views and stores ensured",
    );
  });
}

// A rule's tag filters: the sample's tags must carry the key with that
// value. The tags travel as a JSON string in the column.
function tagConditions(tags: Record<string, string> | undefined): ChQuery[] {
  if (!tags) return [];
  return Object.entries(tags).map(
    ([key, value]) => sql`JSONExtractString(tags, ${key}) = ${value}`,
  );
}

function withTags(conditions: ChQuery[], tags: Record<string, string> | undefined): ChQuery[] {
  return [...conditions, ...tagConditions(tags)];
}

// The tags travel as a JSON string in the column.
function parseTags(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const tags: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof entry === "string") tags[key] = entry;
    }
    return tags;
  } catch {
    return {};
  }
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

// Combines required and scope conditions into a `WHERE` fragment; no
// conditions at all (unscoped reads) yields an empty fragment.
function conditionsToWhere(conditions: readonly ChQuery[]): ChQuery {
  if (conditions.length === 0) return sql``;
  return sql`WHERE ${joinChunks(conditions, sql` AND `)}`;
}

export async function listClickHouseEvents(options?: {
  cursor?: string;
  limit?: number;
  projectId?: string;
  appIds?: string[];
  since?: string;
}): Promise<{ data: StoredEvent[] }> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);

  // An environment filter resolves to the ids of its apps first; an
  // environment without apps has no events.
  if (options?.appIds && options.appIds.length === 0) {
    return { data: [] };
  }

  // Keyset pagination: `cursor` is the id of the last event the caller saw.
  // Its `receivedAt` anchors the slice, so a deep page never scans (or
  // counts) the events before it.
  let after: ChQuery | undefined;
  if (options?.cursor) {
    const anchor = await findClickHouseEvent(options.cursor);
    if (!anchor) return { data: [] };
    const at = sql`parseDateTime64BestEffort(${anchor.receivedAt}, 3)`;
    after = sql`(receivedAt < ${at} OR (receivedAt = ${at} AND id < ${anchor.id}))`;
  }

  const conditions: ChQuery[] = [];
  if (options?.projectId) conditions.push(sql`projectId = ${options.projectId}`);
  if (options?.appIds) conditions.push(sql`appId IN ${options.appIds}`);
  // A null parse (junk `since`) yields no rows, like any other empty filter.
  if (options?.since)
    conditions.push(
      sql`receivedAt >= parseDateTime64BestEffortOrNull(${options.since}, 3)`,
    );
  if (after) conditions.push(after);
  const where = conditionsToWhere(conditions);

  const rows = await queryRows<ClickHouseEventRow>(sql`
    SELECT ${columnList(EVENTS_COLUMNS)}
    FROM ${EVENTS_TABLE} FINAL
    ${where}
    ORDER BY receivedAt DESC, id DESC
    LIMIT ${limit}
  `);

  return { data: rows.map(toStoredEvent) };
}

// --- The derived issue index ---------------------------------------------

export interface IssueOccurrence {
  messageId: string;
  eventId: string;
  receivedAt: string;
  title: string;
  level: string;
  release: string | null;
  environment: string | null;
  user: string | null;
}

export interface IssueStatsPoint {
  bucketStart: string;
  eventCount: number;
  userCount: number;
}

export interface IssueStatsTotals {
  eventCount: number;
  userCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

const ISSUE_OCCURRENCE_COLUMNS = [
  "messageId",
  "eventId",
  "receivedAt",
  "title",
  "level",
  "release",
  "environment",
  "user",
] as const;

interface ClickHouseIssueRow {
  messageId: string;
  eventId: string;
  receivedAt: string;
  title: string;
  level: string;
  release: string;
  environment: string;
  user: string;
}

function toIssueOccurrence(row: ClickHouseIssueRow): IssueOccurrence {
  return {
    messageId: row.messageId,
    eventId: row.eventId,
    receivedAt: toIsoTimestamp(row.receivedAt),
    title: row.title,
    level: row.level,
    release: row.release || null,
    environment: row.environment || null,
    user: row.user || null,
  };
}

// The occurrences of one issue, newest first.
export async function listClickHouseIssueOccurrences(options: {
  appId: string;
  fingerprint: string;
  cursor?: string;
  limit?: number;
}): Promise<{ data: IssueOccurrence[] }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  let after: ChQuery | undefined;
  if (options.cursor) {
    const anchor = await queryRows<{ receivedAt: string; eventId: string }>(sql`
      SELECT receivedAt, eventId FROM ${ISSUE_EVENTS_TABLE} FINAL
      WHERE appId = ${options.appId} AND fingerprint = ${options.fingerprint}
      ORDER BY receivedAt DESC, eventId DESC
      LIMIT 1
    `);
    const row = anchor[0];
    if (!row) return { data: [] };
    const at = sql`parseDateTime64BestEffort(${row.receivedAt}, 3)`;
    after = sql`(receivedAt < ${at} OR (receivedAt = ${at} AND eventId < ${row.eventId}))`;
  }

  const conditions: ChQuery[] = [
    sql`appId = ${options.appId}`,
    sql`fingerprint = ${options.fingerprint}`,
  ];
  if (after) conditions.push(after);

  const rows = await queryRows<ClickHouseIssueRow>(sql`
    SELECT ${columnList(ISSUE_OCCURRENCE_COLUMNS.map((name) => [name, "String"] as const))}
    FROM ${ISSUE_EVENTS_TABLE} FINAL
    ${conditionsToWhere(conditions)}
    ORDER BY receivedAt DESC, eventId DESC
    LIMIT ${limit}
  `);
  return { data: rows.map(toIssueOccurrence) };
}

// The bucketed stats of one issue over a window.
export async function clickHouseIssueStats(options: {
  appId: string;
  fingerprint: string;
  from: string;
  to: string;
  stepSeconds: number;
}): Promise<{ points: IssueStatsPoint[]; totals: IssueStatsTotals }> {
  const from = sql`parseDateTime64BestEffort(${options.from}, 3)`;
  const to = sql`parseDateTime64BestEffort(${options.to}, 3)`;

  const rows = await queryRows<{
    bucketStart: string;
    eventCount: number;
    userCount: number;
  }>(sql`
    SELECT
      toStartOfInterval(receivedAt, INTERVAL ${options.stepSeconds} SECOND) AS bucketStart,
      count() AS eventCount,
      uniqIf(user, user != '') AS userCount
    FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE appId = ${options.appId}
      AND fingerprint = ${options.fingerprint}
      AND receivedAt >= ${from}
      AND receivedAt <= ${to}
    GROUP BY bucketStart
    ORDER BY bucketStart ASC
  `);

  const totals = await queryRows<{
    eventCount: number;
    userCount: number;
    firstSeen: string;
    lastSeen: string;
  }>(sql`
    SELECT
      count() AS eventCount,
      uniqIf(user, user != '') AS userCount,
      min(receivedAt) AS firstSeen,
      max(receivedAt) AS lastSeen
    FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE appId = ${options.appId}
      AND fingerprint = ${options.fingerprint}
      AND receivedAt >= ${from}
      AND receivedAt <= ${to}
  `);

  const total = totals[0];
  return {
    points: rows.map((row) => ({
      bucketStart: toIsoTimestamp(row.bucketStart),
      eventCount: Number(row.eventCount),
      userCount: Number(row.userCount),
    })),
    totals: {
      eventCount: Number(total?.eventCount ?? 0),
      userCount: Number(total?.userCount ?? 0),
      firstSeen: total?.firstSeen ? toIsoTimestamp(total.firstSeen) : null,
      lastSeen: total?.lastSeen ? toIsoTimestamp(total.lastSeen) : null,
    },
  };
}

// The fingerprints that carry a release, across the given apps.
export async function clickHouseReleaseFingerprints(options: {
  release: string;
  appIds: string[];
}): Promise<string[]> {
  if (options.appIds.length === 0) return [];
  const rows = await queryRows<{ fingerprint: string }>(sql`
    SELECT DISTINCT fingerprint FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE release = ${options.release} AND appId IN ${options.appIds}
  `);
  return rows.map((row) => row.fingerprint);
}

// The fingerprints whose occurrences carry a level, across the given apps.
// The semantics are "any occurrence" — the level of the latest occurrence
// is not the level of the issue.
export async function clickHouseIssueFingerprintsByLevel(options: {
  level: string;
  appIds: string[];
}): Promise<string[]> {
  if (options.appIds.length === 0) return [];
  const rows = await queryRows<{ fingerprint: string }>(sql`
    SELECT DISTINCT fingerprint FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE level = ${options.level} AND appId IN ${options.appIds}
  `);
  return rows.map((row) => row.fingerprint);
}

// The fingerprints whose occurrences carry a user, across the given apps.
export async function clickHouseIssueFingerprintsByUser(options: {
  user: string;
  appIds: string[];
}): Promise<string[]> {
  if (options.appIds.length === 0) return [];
  const rows = await queryRows<{ fingerprint: string }>(sql`
    SELECT DISTINCT fingerprint FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE user = ${options.user} AND appId IN ${options.appIds}
  `);
  return rows.map((row) => row.fingerprint);
}

// The fingerprints whose occurrences carry a tag — the tags travel as a
// JSON string in the column.
export async function clickHouseIssueFingerprintsByTag(options: {
  key: string;
  value: string;
  appIds: string[];
}): Promise<string[]> {
  if (options.appIds.length === 0) return [];
  const rows = await queryRows<{ fingerprint: string }>(sql`
    SELECT DISTINCT fingerprint FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE JSONExtractString(tags, ${options.key}) = ${options.value}
      AND appId IN ${options.appIds}
  `);
  return rows.map((row) => row.fingerprint);
}

// The distinct-user count per (app, fingerprint) over the issue index —
// the read side of `sort=users`; the caller syncs it into the issues table.
export async function clickHouseIssueUserCounts(options: {
  appIds: string[];
}): Promise<Array<{ appId: string; fingerprint: string; userCount: number }>> {
  if (options.appIds.length === 0) return [];
  const rows = await queryRows<{
    appId: string;
    fingerprint: string;
    userCount: number;
  }>(sql`
    SELECT appId, fingerprint, uniqIf(user, user != '') AS userCount
    FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE appId IN ${options.appIds}
    GROUP BY appId, fingerprint
  `);
  return rows.map((row) => ({
    appId: row.appId,
    fingerprint: row.fingerprint,
    userCount: Number(row.userCount),
  }));
}

// The issue metrics of a release, read from the issue index: the
// occurrences of the release, plus the first appearance of the issue (the
// release it was first seen in decides whether it is new).
export async function clickHouseReleaseIssueMetrics(options: {
  release: string;
  appIds: string[];
}): Promise<
  Array<{
    fingerprint: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    isNew: boolean;
  }>
> {
  if (options.appIds.length === 0) return [];
  const rows = await queryRows<{
    fingerprint: string;
    firstRelease: string;
    firstSeen: string;
    lastSeen: string;
    count: string;
  }>(sql`
    SELECT
      fingerprint,
      argMin(release, receivedAt) AS firstRelease,
      min(receivedAt) AS firstSeen,
      max(receivedAt) AS lastSeen,
      countIf(release = ${options.release}) AS count
    FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE appId IN ${options.appIds}
    GROUP BY fingerprint
    HAVING count > 0
  `);
  return rows
    .map((row) => ({
      fingerprint: row.fingerprint,
      count: Number(row.count),
      firstSeen: toIsoTimestamp(row.firstSeen),
      lastSeen: toIsoTimestamp(row.lastSeen),
      isNew: row.firstRelease === options.release,
    }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

export async function findClickHouseEvent(id: string): Promise<StoredEvent | undefined> {
  const rows = await queryRows<ClickHouseEventRow>(sql`
    SELECT ${columnList(EVENTS_COLUMNS)}
    FROM ${EVENTS_TABLE} FINAL
    WHERE id = ${id}
    LIMIT 1
  `);
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
    tags: string;
    receivedAt: string;
  }>(sql`
    SELECT ${columnList(METRICS_COLUMNS)}
    FROM ${METRICS_TABLE} FINAL
    WHERE eventId = ${eventId}
    ORDER BY metric ASC
  `);
  return rows.map((row) => ({
    projectId: row.projectId,
    appId: row.appId,
    eventId: row.eventId,
    metric: row.metric,
    value: Number(row.value),
    dimension: row.dimension,
    tags: parseTags(row.tags),
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

function metricsWhere(options: MetricReadFilter): ChQuery {
  const conditions: ChQuery[] = [
    sql`metric = ${options.metric}`,
    atOrAfter(options.from),
    atOrBefore(options.to),
  ];
  if (options.projectId) conditions.push(sql`projectId = ${options.projectId}`);
  if (options.appIds) conditions.push(sql`appId IN ${options.appIds}`);
  return conditionsToWhere(conditions);
}

// Quantiles come out of the raw samples at read time — exact per bucket,
// no rollups and no histogram approximation.
export async function listMetricSeries(
  options: MetricReadFilter & { stepSeconds: number },
): Promise<MetricSeriesPoint[]> {
  // An environment without apps has no samples (an empty `IN ()` is not
  // valid SQL).
  if (options.appIds && options.appIds.length === 0) return [];
  const rows = await queryRows<{
    bucketStart: string;
    count: string | number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  }>(sql`
    SELECT toStartOfInterval(receivedAt, INTERVAL ${options.stepSeconds} SECOND) AS bucketStart,
           count() AS count,
           avg(value) AS mean,
           quantile(0.5)(value) AS p50,
           quantile(0.95)(value) AS p95,
           quantile(0.99)(value) AS p99
    FROM ${METRICS_TABLE} FINAL
    ${metricsWhere(options)}
    GROUP BY bucketStart
    ORDER BY bucketStart ASC
  `);
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
  const rows = await queryRows<{
    dimension: string;
    count: string | number;
    mean: number;
    p50: number;
    p95: number;
  }>(sql`
    SELECT dimension,
           count() AS count,
           avg(value) AS mean,
           quantile(0.5)(value) AS p50,
           quantile(0.95)(value) AS p95
    FROM ${METRICS_TABLE} FINAL
    ${metricsWhere(options)}
    GROUP BY dimension
    ORDER BY count DESC, dimension ASC
    LIMIT ${options.limit}
  `);
  return rows.map((row) => ({
    dimension: row.dimension,
    count: Number(row.count),
    mean: Number(row.mean),
    p50: Number(row.p50),
    p95: Number(row.p95),
  }));
}

// Alerting reads: how many sentinel samples of one metric an app produced
// inside the window (one row per event/error/fatal event).
export async function countClickHouseMetricSamples(options: {
  appId: string;
  metric: string;
  since: string;
  until?: string;
  tags?: Record<string, string>;
}): Promise<number> {
  const conditions = withTags(
    [
      sql`appId = ${options.appId}`,
      sql`metric = ${options.metric}`,
      atOrAfter(options.since),
      ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ],
    options.tags,
  );
  const rows = await queryRows<{ total: string | number }>(sql`
    SELECT count() AS total FROM ${METRICS_TABLE} FINAL
    ${conditionsToWhere(conditions)}
  `);
  return Number(rows[0]?.total ?? 0);
}

// The latency metrics: a quantile over the samples of one metric (the
// rule's measurement, `duration` by default). An empty window has no
// quantile — reported as 0, never NaN.
export async function quantileClickHouseMetricSamples(options: {
  appId: string;
  metric: string;
  quantile: number;
  since: string;
  until?: string;
  tags?: Record<string, string>;
}): Promise<number> {
  const conditions = withTags(
    [
      sql`appId = ${options.appId}`,
      sql`metric = ${options.metric}`,
      atOrAfter(options.since),
      ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ],
    options.tags,
  );
  const rows = await queryRows<{ value: number }>(sql`
    SELECT quantile(${sql.param(options.quantile / 100, "Float64")})(value) AS value
    FROM ${METRICS_TABLE} FINAL
    ${conditionsToWhere(conditions)}
  `);
  const value = Number(rows[0]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// The same counts over a whole project — the project-scoped rules
// aggregate the samples of every app in the project.
export async function countClickHouseMetricSamplesByProject(options: {
  projectId: string;
  metric: string;
  since: string;
  until?: string;
  tags?: Record<string, string>;
}): Promise<number> {
  const conditions = withTags(
    [
      sql`projectId = ${options.projectId}`,
      sql`metric = ${options.metric}`,
      atOrAfter(options.since),
      ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ],
    options.tags,
  );
  const rows = await queryRows<{ total: string | number }>(sql`
    SELECT count() AS total FROM ${METRICS_TABLE} FINAL
    ${conditionsToWhere(conditions)}
  `);
  return Number(rows[0]?.total ?? 0);
}

export async function quantileClickHouseMetricSamplesByProject(options: {
  projectId: string;
  metric: string;
  quantile: number;
  since: string;
  until?: string;
  tags?: Record<string, string>;
}): Promise<number> {
  const conditions = withTags(
    [
      sql`projectId = ${options.projectId}`,
      sql`metric = ${options.metric}`,
      atOrAfter(options.since),
      ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ],
    options.tags,
  );
  const rows = await queryRows<{ value: number }>(sql`
    SELECT quantile(${sql.param(options.quantile / 100, "Float64")})(value) AS value
    FROM ${METRICS_TABLE} FINAL
    ${conditionsToWhere(conditions)}
  `);
  const value = Number(rows[0]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// Every event of one project, oldest first — used by the release summary.
// Row order follows `EVENTS_COLUMNS`; `receivedAt` is bound as a String
// and cast by the target column so callers pass ISO timestamps.
function eventRow(event: StoredEvent): string[] {
  return [
    event.id,
    event.projectId,
    event.appId ?? "",
    event.envelopeHeader,
    event.envelopeItems,
    event.receivedAt,
  ];
}

// Direct inserts used by tests to seed the store; ingestion itself writes
// through the NATS engine tables and views.
export async function insertClickHouseEvents(events: StoredEvent[]): Promise<void> {
  if (events.length === 0) return;
  await runCommand(sql`
    INSERT INTO ${EVENTS_TABLE} (${columnList(EVENTS_COLUMNS)})
    VALUES ${sql.values(events.map(eventRow), columnTypes(EVENTS_COLUMNS))}
  `);
}

// Row order follows `METRICS_COLUMNS`; `receivedAt` is bound as a String
// and cast by the target column so callers pass ISO timestamps.
function metricSampleRow(sample: MetricSample): (string | number)[] {
  return [
    sample.projectId,
    sample.appId,
    sample.eventId,
    sample.metric,
    sample.value,
    sample.dimension,
    JSON.stringify(sample.tags ?? {}),
    sample.receivedAt,
  ];
}

export async function insertClickHouseMetricSamples(samples: MetricSample[]): Promise<void> {
  if (samples.length === 0) return;
  await runCommand(sql`
    INSERT INTO ${METRICS_TABLE} (${columnList(METRICS_COLUMNS)})
    VALUES ${sql.values(samples.map(metricSampleRow), columnTypes(METRICS_COLUMNS))}
  `);
}
