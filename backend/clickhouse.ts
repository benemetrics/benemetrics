import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseDialect, SQLQuery } from "waddler";
import { sql, waddler, type ClickHouseSQL } from "waddler/clickhouse";
import {
  CLICKHOUSE_DATABASE,
  DEFAULT_EVENTS_TTL,
  EVENTS_COLUMNS,
  EVENTS_TABLE,
  ISSUE_EVENTS_TABLE,
  METRICS_COLUMNS,
  METRICS_TABLE,
  atOrAfter,
  atOrBefore,
  columnList,
  columnTypes,
  chTable,
  type ChColumn,
  type ChQuery,
  type TtlUnit,
  ttlExpression,
  EVENTS_TABLE_NAME,
} from "./clickhouse-migrations/_ddl";
import {
  CLICKHOUSE_MIGRATIONS,
  type MigrationDb,
} from "./clickhouse-migrations";
import type { StoredEvent } from "./protocol/events";
import type {
  MetricBreakdownRow,
  MetricSample,
  MetricSeriesPoint,
} from "./protocol/metrics";

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || "localhost";
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT || "8123";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";

// Share the retention type with the Settings surface without re-exporting
// the whole DDL module.
export type { TtlUnit } from "./clickhouse-migrations/_ddl";

// Waddler handle: created on first use and dropped on close so test files
// can open and close the store repeatedly.
let client: ClickHouseClient | null = null;
let ch: ClickHouseSQL | null = null;

function getCh(): ClickHouseSQL {
  if (!ch) {
    client = createClient({
      url: `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
      request_timeout: 5000,
    });
    ch = waddler({ client });
  }
  return ch;
}

export async function closeClickHouse(): Promise<void> {
  const current = client;
  client = null;
  ch = null;
  if (current) await current.close();
}

// Executes a statement without a result set (DDL, INSERT, TRUNCATE).
async function runCommand(statement: ChQuery): Promise<void> {
  await withChRetry(async () => await getCh()`${statement}`.command());
}

// Executes a SELECT and returns its rows in the object row mode, typed
// like a Drizzle result through the template's row parameter.
async function queryRows<T>(statement: ChQuery): Promise<T[]> {
  return await withChRetry(async () => await getCh()<T>`${statement}`);
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

// --- Migrations -----------------------------------------------------------

// The recorded history: ReplacingMergeTree so a retried record insert
// collapses on FINAL reads.
const MIGRATIONS_TABLE = chTable("clickhouse_migrations");

async function recordMigration(name: string): Promise<void> {
  await runCommand(
    sql`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ${sql.values([[name]], ["String"])}`,
  );
}

// Applies the pending migrations in order. A recorded name is skipped; a
// migration whose `needed` probe reports the DB already in the target
// shape is only recorded. Each statement runs through the same retry path
// as the reads, so a slow ClickHouse start retries instead of failing.
async function runMigrations(): Promise<void> {
  await runCommand(sql`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE}
    (name String, appliedAt DateTime64(3) DEFAULT now64(3))
    ENGINE = ReplacingMergeTree()
    ORDER BY name
  `);

  const db: MigrationDb = { command: runCommand, rows: queryRows };
  const applied = new Set(
    (
      await queryRows<{ name: string }>(
        sql`SELECT name FROM ${MIGRATIONS_TABLE} FINAL`,
      )
    ).map((row) => row.name),
  );

  for (const migration of CLICKHOUSE_MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    // Already in the target shape (an install predating the migrations):
    // record the history instead of rerunning the statements.
    if (migration.needed && !(await migration.needed(db))) {
      await recordMigration(migration.name);
      continue;
    }
    console.log(`[ClickHouse] Applying migration ${migration.name}`);
    for (const statement of await migration.statements(db)) {
      await runCommand(statement);
    }
    await recordMigration(migration.name);
  }
}

// Boot order: NATS (stream + durable pull consumers) first — the engine
// tables attach to their consumers by name. Retries, then fails fast.
export async function initClickHouse(): Promise<void> {
  await retryInit(async () => {
    await runCommand(
      sql`CREATE DATABASE IF NOT EXISTS ${sql.identifier(CLICKHOUSE_DATABASE)}`,
    );
    await runMigrations();
    console.log(
      "[ClickHouse] Connected; events and metrics engine tables, views and stores ensured",
    );
  });
}

// --- Retention (Settings API) ---------------------------------------------

export interface EventsTtl {
  table: string;
  expression: string;
  interval: { amount: number; unit: TtlUnit } | null;
}

// The lifetime of the events table, parsed back from the stored CREATE
// TABLE query ClickHouse keeps in `system.tables`.
export async function readEventsTtl(): Promise<EventsTtl> {
  const [table] = await queryRows<{ create_table_query: string }>(sql`
    SELECT create_table_query FROM system.tables
    WHERE database = ${CLICKHOUSE_DATABASE} AND name = ${EVENTS_TABLE_NAME}
  `);
  if (!table)
    return { table: EVENTS_TABLE_NAME, expression: "", interval: null };
  const match = /\bTTL\s+(.+?)(?=\s+SETTINGS\b|\s*$)/is.exec(
    table.create_table_query,
  );
  if (!match)
    return { table: EVENTS_TABLE_NAME, expression: "", interval: null };
  const expression = match[1]!.trim();
  const interval = /toInterval(Month|Week|Day|Year)\((\d+)\)/i.exec(expression);
  return {
    table: EVENTS_TABLE_NAME,
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
  for (const table of [EVENTS_TABLE, METRICS_TABLE, ISSUE_EVENTS_TABLE]) {
    await runCommand(
      sql`ALTER TABLE ${table} MODIFY TTL ${sql.raw(expression)}`,
    );
  }
  return readEventsTtl();
}

// --- Reads ----------------------------------------------------------------

// Waddler has no `sql.join`, so a fragments list is joined by hand.
function joinChunks(chunks: readonly ChQuery[], separator: ChQuery): ChQuery {
  const [first, ...rest] = chunks;
  if (!first) return sql``;
  for (const chunk of rest) {
    first.append(separator);
    first.append(chunk);
  }
  return first;
}

// Combines required and scope conditions into a `WHERE` fragment; no
// conditions at all (unscoped reads) yields an empty fragment.
function conditionsToWhere(conditions: readonly ChQuery[]): ChQuery {
  if (conditions.length === 0) return sql``;
  return sql`WHERE ${joinChunks(conditions, sql` AND `)}`;
}

// A rule's tag filters: the sample's tags must carry the key with that
// value. The tags travel as a JSON string in the column.
function tagConditions(tags: Record<string, string> | undefined): ChQuery[] {
  if (!tags) return [];
  return Object.entries(tags).map(
    ([key, value]) => sql`JSONExtractString(tags, ${key}) = ${value}`,
  );
}

// The tags travel as a JSON string in the column.
function parseTags(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const tags: Record<string, string> = {};
    for (const [key, entry] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
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
  const parsed = new Date(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
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
  if (options?.projectId)
    conditions.push(sql`projectId = ${options.projectId}`);
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

export async function findClickHouseEvent(
  id: string,
): Promise<StoredEvent | undefined> {
  const rows = await queryRows<ClickHouseEventRow>(sql`
    SELECT ${columnList(EVENTS_COLUMNS)}
    FROM ${EVENTS_TABLE} FINAL
    WHERE id = ${id}
    LIMIT 1
  `);
  return rows[0] ? toStoredEvent(rows[0]) : undefined;
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

// The SELECT list of the occurrence queries; the filter and scope columns
// (`fingerprint`, `projectId`, `tags`) stay out of the row type.
const ISSUE_OCCURRENCE_COLUMNS: readonly ChColumn[] = [
  ["messageId", "String"],
  ["eventId", "String"],
  ["receivedAt", "DateTime64(3)"],
  ["title", "String"],
  ["level", "String"],
  ["release", "String"],
  ["environment", "String"],
  ["user", "String"],
];

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
    SELECT ${columnList(ISSUE_OCCURRENCE_COLUMNS)}
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
  const from = atOrAfter(options.from);
  const to = atOrBefore(options.to);
  const scope = sql`appId = ${options.appId} AND fingerprint = ${options.fingerprint}`;

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
    WHERE ${scope} AND ${from} AND ${to}
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
    WHERE ${scope} AND ${from} AND ${to}
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

// The fingerprints whose occurrences carry a value across the given apps.
// The semantics are "any occurrence" — the level of the latest occurrence
// is not the level of the issue.
async function issueFingerprintsWhere(
  condition: ChQuery,
  appIds: string[],
): Promise<string[]> {
  if (appIds.length === 0) return [];
  const rows = await queryRows<{ fingerprint: string }>(sql`
    SELECT DISTINCT fingerprint FROM ${ISSUE_EVENTS_TABLE} FINAL
    WHERE ${condition} AND appId IN ${appIds}
  `);
  return rows.map((row) => row.fingerprint);
}

// The fingerprints that carry a release, across the given apps.
export async function clickHouseReleaseFingerprints(options: {
  release: string;
  appIds: string[];
}): Promise<string[]> {
  return issueFingerprintsWhere(
    sql`release = ${options.release}`,
    options.appIds,
  );
}

// The fingerprints whose occurrences carry a level, across the given apps.
export async function clickHouseIssueFingerprintsByLevel(options: {
  level: string;
  appIds: string[];
}): Promise<string[]> {
  return issueFingerprintsWhere(sql`level = ${options.level}`, options.appIds);
}

// The fingerprints whose occurrences carry a user, across the given apps.
export async function clickHouseIssueFingerprintsByUser(options: {
  user: string;
  appIds: string[];
}): Promise<string[]> {
  return issueFingerprintsWhere(sql`user = ${options.user}`, options.appIds);
}

// The fingerprints whose occurrences carry a tag — the tags travel as a
// JSON string in the column.
export async function clickHouseIssueFingerprintsByTag(options: {
  key: string;
  value: string;
  appIds: string[];
}): Promise<string[]> {
  return issueFingerprintsWhere(
    sql`JSONExtractString(tags, ${options.key}) = ${options.value}`,
    options.appIds,
  );
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

// Alerting reads: how many samples of one metric a scope produced inside
// the window (one row per event/error/fatal event).
export async function countClickHouseMetricSamples(options: {
  appId: string;
  metric: string;
  since: string;
  until?: string;
  tags?: Record<string, string>;
}): Promise<number> {
  const conditions = [
    sql`appId = ${options.appId}`,
    sql`metric = ${options.metric}`,
    atOrAfter(options.since),
    ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ...tagConditions(options.tags),
  ];
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
  const conditions = [
    sql`appId = ${options.appId}`,
    sql`metric = ${options.metric}`,
    atOrAfter(options.since),
    ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ...tagConditions(options.tags),
  ];
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
  const conditions = [
    sql`projectId = ${options.projectId}`,
    sql`metric = ${options.metric}`,
    atOrAfter(options.since),
    ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ...tagConditions(options.tags),
  ];
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
  const conditions = [
    sql`projectId = ${options.projectId}`,
    sql`metric = ${options.metric}`,
    atOrAfter(options.since),
    ...(options.until !== undefined ? [atOrBefore(options.until)] : []),
    ...tagConditions(options.tags),
  ];
  const rows = await queryRows<{ value: number }>(sql`
    SELECT quantile(${sql.param(options.quantile / 100, "Float64")})(value) AS value
    FROM ${METRICS_TABLE} FINAL
    ${conditionsToWhere(conditions)}
  `);
  const value = Number(rows[0]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// --- Inserts --------------------------------------------------------------

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
export async function insertClickHouseEvents(
  events: StoredEvent[],
): Promise<void> {
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

export async function insertClickHouseMetricSamples(
  samples: MetricSample[],
): Promise<void> {
  if (samples.length === 0) return;
  await runCommand(sql`
    INSERT INTO ${METRICS_TABLE} (${columnList(METRICS_COLUMNS)})
    VALUES ${sql.values(samples.map(metricSampleRow), columnTypes(METRICS_COLUMNS))}
  `);
}
