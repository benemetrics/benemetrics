import type { SQLQuery } from "waddler";
import { sql } from "waddler/clickhouse";
import {
  CLICKHOUSE_DATABASE,
  EVENTS_ENGINE_TABLE,
  createEventsEngineTable,
  createMetricsEngineTable,
  chTable,
} from "./_ddl";
import type { MigrationDb } from "./db";
import type { ClickHouseMigration } from "./types";

const tableQuery = async (db: MigrationDb, table: string) => {
  const [row] = await db.rows<{ create_table_query: string }>(
    sql`
      SELECT create_table_query FROM system.tables
      WHERE database = ${CLICKHOUSE_DATABASE} AND name = ${table}
    `,
  );
  return row?.create_table_query ?? "";
};

const columnExists = async (
  db: MigrationDb,
  table: string,
  column: string,
): Promise<boolean> => {
  const [row] = await db.rows<{ name: string }>(
    sql`
      SELECT name FROM system.columns
      WHERE database = ${CLICKHOUSE_DATABASE} AND table = ${table}
        AND name = ${column}
    `,
  );
  return row !== undefined;
};

// A NATS table cannot be altered: when an existing engine table predates
// the engine credentials or a column, it is recreated — the rows live in
// the stream, so the durable's position is what carries over.
export const migration: ClickHouseMigration = {
  name: "0002_engine_tables",
  statements: async (db) => {
    const statements: SQLQuery[] = [];
    for (const table of ["nats_events", "nats_metrics"]) {
      // Engine tables created before the credentials carried none.
      if (!(await tableQuery(db, table)).includes("nats_username")) {
        statements.push(sql`DROP TABLE IF EXISTS ${chTable(table)}`);
      }
    }
    if (!(await columnExists(db, "nats_events", "issueEvents"))) {
      statements.push(sql`DROP TABLE IF EXISTS ${EVENTS_ENGINE_TABLE}`);
    }
    if (!(await columnExists(db, "nats_metrics", "tags"))) {
      statements.push(sql`DROP TABLE IF EXISTS ${chTable("nats_metrics")}`);
    }
    statements.push(createEventsEngineTable(), createMetricsEngineTable());
    return statements;
  },
};
