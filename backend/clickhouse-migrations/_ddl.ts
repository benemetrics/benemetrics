import type { ClickHouseDialect, SQLQuery } from "waddler";
import { sql } from "waddler/clickhouse";

// A statement or fragment built with the standalone `sql` builder and
// executed through the waddler handle (`.command()` / `.query()`).
export type ChQuery = SQLQuery<ClickHouseDialect>;

export const CLICKHOUSE_DATABASE =
  process.env.CLICKHOUSE_DATABASE || "default";
const CLICKHOUSE_NATS_URL = process.env.CLICKHOUSE_NATS_URL || "nats:4222";
// The engine connection is the `INTERNAL` config user of the broker.
const CLICKHOUSE_NATS_USER =
  process.env.CLICKHOUSE_NATS_USER || "sentries-internal";
const CLICKHOUSE_NATS_PASSWORD =
  process.env.CLICKHOUSE_NATS_PASSWORD || "sentries-dev-internal-pass";

const NATS_STREAM = "BENEMETRICS";
const EVENTS_SUBJECT = "benemetrics.events.*";
const EVENTS_CONSUMER = "clickhouse-events";
const METRICS_SUBJECT = "benemetrics.metrics";
const METRICS_CONSUMER = "clickhouse-metrics";

// Waddler's ClickHouse driver exposes the `sql` template only — it has no
// table DSL — so the schema is declared once here and drives the DDL, the
// SELECT lists and the INSERT bindings. Column order is significant: it is
// the order of the rows passed to `sql.values`.
//
// The optional third element is the type the value binds as when the
// declared type cannot parse the value as sent: `receivedAt` is an ISO
// string (with `T`/`Z`) that ClickHouse rejects as a DateTime64 parameter,
// so it is bound as a String and cast by the target column.
export type ChColumn = readonly [name: string, type: string, bind?: string];

export const EVENTS_COLUMNS: readonly ChColumn[] = [
  ["id", "String"],
  ["projectId", "String"],
  ["appId", "String"],
  ["envelopeHeader", "String"],
  ["envelopeItems", "String"],
  ["receivedAt", "DateTime64(3)", "String"],
];

// The engine table receives JSONEachRow, so the timestamp arrives as a
// string; `type` distinguishes envelope from store messages.
export const EVENTS_ENGINE_COLUMNS: readonly ChColumn[] = [
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
export const ISSUE_EVENTS_COLUMNS: readonly ChColumn[] = [
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

export const METRICS_COLUMNS: readonly ChColumn[] = [
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

export const METRICS_ENGINE_COLUMNS: readonly ChColumn[] = [
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
export const chTable = (name: string) =>
  sql.identifier({ schema: CLICKHOUSE_DATABASE, table: name });

export const EVENTS_TABLE = chTable("benemetrics_events");
export const EVENTS_TABLE_NAME = "benemetrics_events";
export const EVENTS_OLD_TABLE = chTable("benemetrics_events_old");
export const EVENTS_ENGINE_TABLE = chTable("nats_events");
export const EVENTS_VIEW = chTable("benemetrics_events_mv");
export const ISSUE_EVENTS_TABLE = chTable("benemetrics_issue_events");
export const ISSUE_EVENTS_VIEW = chTable("benemetrics_issue_events_mv");
export const METRICS_TABLE = chTable("benemetrics_metrics");
export const METRICS_ENGINE_TABLE = chTable("nats_metrics");
export const METRICS_VIEW = chTable("benemetrics_metrics_mv");

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
export function columnList(columns: readonly ChColumn[]): ChQuery {
  return joinChunks(
    columns.map(([name]) => sql`${sql.identifier(name)}`),
    sql`, `,
  );
}

// `` `id` String, `projectId` String, … `` — the CREATE TABLE body.
export function columnDefinitions(columns: readonly ChColumn[]): ChQuery {
  return joinChunks(
    columns.map(
      ([name, type]) => sql`${sql.identifier(name)} ${sql.raw(type)}`,
    ),
    sql`, `,
  );
}

// Bound explicitly in `sql.values`; the binding type is the declared type
// unless the schema overrides it.
export function columnTypes(columns: readonly ChColumn[]): string[] {
  return columns.map(([, type, bind]) => bind ?? type);
}

// The views select every payload column; the timestamp is recomputed from
// the parsed engine value instead.
export function payloadList(columns: readonly ChColumn[]): ChQuery {
  return columnList(columns.filter(([name]) => name !== "receivedAt"));
}

// A malformed `receivedAt` (junk published to the subject) must be
// skipped — acked and dropped — instead of wedging the engine's insert
// loop with a parse exception that would be redelivered forever. The
// OrNull parse plus the null guard is therefore both the insert
// expression and the views' definition marker.
export const RECEIVED_AT_PARSE = "parseDateTime64BestEffortOrNull(receivedAt, 3)";

// ISO window bounds are parsed at millisecond precision by ClickHouse.
export const atOrAfter = (iso: string) =>
  sql`receivedAt >= parseDateTime64BestEffort(${iso}, 3)`;
export const atOrBefore = (iso: string) =>
  sql`receivedAt <= parseDateTime64BestEffort(${iso}, 3)`;

export type TtlUnit = "day" | "week" | "month" | "year";

export const DEFAULT_EVENTS_TTL: { amount: number; unit: TtlUnit } = {
  amount: 1,
  unit: "month",
};

export interface EventsTtlInterval {
  amount: number;
  unit: TtlUnit;
}

const INTERVAL_FUNCTIONS: Record<TtlUnit, string> = {
  day: "toIntervalDay",
  week: "toIntervalWeek",
  month: "toIntervalMonth",
  year: "toIntervalYear",
};

export const ttlExpression = (amount: number, unit: TtlUnit): string =>
  `toDateTime(receivedAt) + ${INTERVAL_FUNCTIONS[unit]}(${amount})`;

const withTtl = (expression: string | null) =>
  expression ? sql.raw(`TTL ${expression}`) : sql``;

export function createEventsTable(
  ttl: EventsTtlInterval = DEFAULT_EVENTS_TTL,
): ChQuery {
  const expression =
    ttl.amount > 0 ? ttlExpression(ttl.amount, ttl.unit) : null;
  return sql`
    CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE}
    (${columnDefinitions(EVENTS_COLUMNS)})
    ENGINE = ReplacingMergeTree()
    ORDER BY (projectId, receivedAt, id)
    ${withTtl(expression)}
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

export function createEventsEngineTable(): ChQuery {
  return sql`
    CREATE TABLE IF NOT EXISTS ${EVENTS_ENGINE_TABLE}
    (${columnDefinitions(EVENTS_ENGINE_COLUMNS)})
    ${natsEngine(EVENTS_CONSUMER, EVENTS_SUBJECT)}
  `;
}

export function createEventsView(): ChQuery {
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

export function createIssueEventsTable(
  ttl: EventsTtlInterval = DEFAULT_EVENTS_TTL,
): ChQuery {
  const expression =
    ttl.amount > 0 ? ttlExpression(ttl.amount, ttl.unit) : null;
  return sql`
    CREATE TABLE IF NOT EXISTS ${ISSUE_EVENTS_TABLE}
    (${columnDefinitions(ISSUE_EVENTS_COLUMNS)})
    ENGINE = ReplacingMergeTree()
    ORDER BY (appId, fingerprint, receivedAt, eventId)
    ${withTtl(expression)}
    SETTINGS index_granularity = 8192
  `;
}

// The digests ride the event message as JSON text; the view expands them
// into one row per event item. A message without digests (or with a
// non-array one) contributes no rows.
export function createIssueEventsView(): ChQuery {
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

export function createMetricsTable(
  ttl: EventsTtlInterval = DEFAULT_EVENTS_TTL,
): ChQuery {
  const expression =
    ttl.amount > 0 ? ttlExpression(ttl.amount, ttl.unit) : null;
  return sql`
    CREATE TABLE IF NOT EXISTS ${METRICS_TABLE}
    (${columnDefinitions(METRICS_COLUMNS)})
    ENGINE = ReplacingMergeTree()
    ORDER BY (projectId, metric, receivedAt, eventId, dimension)
    ${withTtl(expression)}
    SETTINGS index_granularity = 8192, fsync_after_insert = 1, fsync_part_directory = 1
  `;
}

export function createMetricsEngineTable(): ChQuery {
  return sql`
    CREATE TABLE IF NOT EXISTS ${METRICS_ENGINE_TABLE}
    (${columnDefinitions(METRICS_ENGINE_COLUMNS)})
    ${natsEngine(METRICS_CONSUMER, METRICS_SUBJECT)}
  `;
}

export function createMetricsView(): ChQuery {
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

// The data-preserving legacy-events migration; the caller passes the
// retention read back from the existing table definition.
export function legacyEventsMigrationStatements(
  interval: EventsTtlInterval,
): ChQuery[] {
  const expression =
    interval.amount > 0 ? ttlExpression(interval.amount, interval.unit) : null;
  return [
    sql`DROP TABLE IF EXISTS ${EVENTS_VIEW}`,
    sql`RENAME TABLE ${EVENTS_TABLE} TO ${EVENTS_OLD_TABLE}`,
    createEventsTable({ amount: 0, unit: interval.unit }),
    sql`
      INSERT INTO ${EVENTS_TABLE} (${columnList(EVENTS_COLUMNS)})
      SELECT id,
             argMax(projectId, receivedAt),
             argMax(appId, receivedAt),
             argMax(envelopeHeader, receivedAt),
             argMax(envelopeItems, receivedAt),
             toDateTime64(max(receivedAt), 3)
      FROM ${EVENTS_OLD_TABLE}
      GROUP BY id
    `,
    sql`DROP TABLE ${EVENTS_OLD_TABLE}`,
    // The rebuilt table carries the same retention the old one had.
    ...(expression
      ? [
          sql`ALTER TABLE ${EVENTS_TABLE} MODIFY TTL ${sql.raw(expression)}`,
          sql`ALTER TABLE ${METRICS_TABLE} MODIFY TTL ${sql.raw(expression)}`,
          sql`ALTER TABLE ${ISSUE_EVENTS_TABLE} MODIFY TTL ${sql.raw(expression)}`,
        ]
      : []),
  ];
}
