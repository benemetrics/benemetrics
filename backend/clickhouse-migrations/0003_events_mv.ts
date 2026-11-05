import type { SQLQuery } from "waddler";
import { sql } from "waddler/clickhouse";
import {
  CLICKHOUSE_DATABASE,
  RECEIVED_AT_PARSE,
  createEventsView,
  chTable,
} from "./_ddl";
import type { MigrationDb } from "./db";
import type { ClickHouseMigration } from "./types";

// The materialized views are the only writers of the store tables. A view
// is dropped and recreated when its stored definition predates the current
// one — detected by the `RECEIVED_AT_PARSE` marker: views created before
// the null-parse guard (which skips junk messages instead of wedging the
// engine's insert loop) are stale.
export const migration: ClickHouseMigration = {
  name: "0003_events_mv",
  statements: async (db) => {
    const statements: SQLQuery[] = [];
    const [existing] = await db.rows<{ create_table_query: string }>(
      sql`
        SELECT create_table_query FROM system.tables
        WHERE database = ${CLICKHOUSE_DATABASE}
          AND name = 'benemetrics_events_mv'
      `,
    );
    if (existing && !existing.create_table_query.includes(RECEIVED_AT_PARSE)) {
      statements.push(sql`DROP TABLE IF EXISTS ${chTable("benemetrics_events_mv")}`);
    }
    statements.push(createEventsView());
    return statements;
  },
};
