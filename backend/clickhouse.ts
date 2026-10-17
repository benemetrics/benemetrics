import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { StoredEvent } from "db/schema/stored-event";
import type { SentryEventMessage } from "./nats";

// ClickHouse is an optional analytics store. For now it only holds
// events: stored envelopes are pushed here best-effort on write, and the
// events API reads from ClickHouse whenever it is available, falling back
// to Postgres (the source of truth) otherwise. Nothing in this module may
// fail an ingestion request or an events read.

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || "localhost";
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT || "8123";
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "default";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";

const TABLE = `${CLICKHOUSE_DATABASE}.sentry_events`;
const COLUMNS = "id, projectId, appId, envelopeHeader, envelopeItems, receivedAt";

let available = false;
let client: ClickHouseClient | null = null;

export function isClickHouseAvailable(): boolean {
  return available;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getClient(): ClickHouseClient {
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
  available = false;
  if (current) await current.close();
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

export async function initClickHouse(): Promise<void> {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ${TABLE}
    (
      id String,
      projectId String,
      appId String,
      envelopeHeader String,
      envelopeItems String,
      receivedAt DateTime
    )
    ENGINE = MergeTree()
    ORDER BY (projectId, receivedAt)
    SETTINGS index_granularity = 8192
  `;

  try {
    const clickhouse = getClient();
    await clickhouse.command({
      query: `CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE}`,
    });
    await clickhouse.command({ query: createTableQuery });
    await clickhouse.command({
      query: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS appId String AFTER projectId`,
    });
    // `raw` was a full copy of the envelope; it is no longer stored
    // anywhere (Postgres dropped it too).
    await clickhouse.command({
      query: `ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS raw`,
    });
    available = true;
    console.log("[ClickHouse] Connected and table ensured");
  } catch (err) {
    available = false;
    console.error("[ClickHouse] Failed to connect or initialize:", describe(err));
  }
}

// One analytics row per stored event.
async function insertEventRow(event: SentryEventMessage): Promise<void> {
  await getClient().insert({
    table: TABLE,
    values: [
      {
        id: event.id,
        projectId: event.projectId,
        appId: event.appId ?? "",
        envelopeHeader: event.envelopeHeader,
        envelopeItems: event.envelopeItems,
        receivedAt: event.receivedAt,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}

// Best-effort push: a no-op while ClickHouse is unavailable, and it
// never throws into the caller.
export function pushClickHouseEvent(event: SentryEventMessage): void {
  if (!available) return;
  void insertEventRow(event).catch((err) => {
    console.error("[ClickHouse] Failed to insert event:", describe(err));
  });
}

export async function clearClickHouseEvents(): Promise<void> {
  if (!available) return;
  try {
    await getClient().command({ query: `TRUNCATE TABLE ${TABLE}` });
  } catch (err) {
    console.error("[ClickHouse] Failed to clear events:", describe(err));
  }
}

// Throws when the query fails; the events-store facade catches and falls
// back to Postgres for that request.
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

  const filterParams: Record<string, string> = {};
  const conditions: string[] = [];
  if (options?.projectId) {
    filterParams.projectId = options.projectId;
    conditions.push("projectId = {projectId:String}");
  }
  if (options?.appIds) {
    const placeholders = options.appIds.map((appId, index) => {
      filterParams[`appId${index}`] = appId;
      return `{appId${index}:String}`;
    });
    conditions.push(`appId IN (${placeholders.join(", ")})`);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

  const clickhouse = getClient();
  const [rowsResult, countResult] = await Promise.all([
    clickhouse.query({
      query: `SELECT ${COLUMNS} FROM ${TABLE}${where} ORDER BY receivedAt DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
      format: "JSONEachRow",
      query_params: { ...filterParams, limit, offset },
    }),
    clickhouse.query({
      query: `SELECT count() AS total FROM ${TABLE}${where}`,
      format: "JSONEachRow",
      query_params: filterParams,
    }),
  ]);

  const [rows, countRows] = await Promise.all([
    rowsResult.json<ClickHouseEventRow>(),
    countResult.json<{ total: string | number }>(),
  ]);
  const total = Number(countRows[0]?.total ?? 0);

  return {
    data: rows.map(toStoredEvent),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Throws when the query fails; the events-store facade catches and falls
// back to Postgres for that request.
export async function findClickHouseEvent(id: string): Promise<StoredEvent | undefined> {
  const resultSet = await getClient().query({
    query: `SELECT ${COLUMNS} FROM ${TABLE} WHERE id = {id:String} LIMIT 1`,
    format: "JSONEachRow",
    query_params: { id },
  });
  const [row] = await resultSet.json<ClickHouseEventRow>();
  return row ? toStoredEvent(row) : undefined;
}
