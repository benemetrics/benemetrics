import type { SQLQuery } from "waddler";
import { sql } from "waddler/clickhouse";
import {
  CLICKHOUSE_DATABASE,
  METRICS_TABLE,
  createMetricsView,
  chTable,
} from "./_ddl";
import type { MigrationDb } from "./db";
import type { ClickHouseMigration } from "./types";

// The metrics' store table and its materialized view gain the tags column
// on an existing installation; the view is recreated when it predates it.
export const migration: ClickHouseMigration = {
  name: "0005_metrics_tags",
  statements: async (db) => {
    const statements: SQLQuery[] = [];
    const [column] = await db.rows<{ name: string }>(
      sql`
        SELECT name FROM system.columns
        WHERE database = ${CLICKHOUSE_DATABASE}
          AND table = 'benemetrics_metrics' AND name = 'tags'
      `,
    );
    if (!column) {
      statements.push(sql`ALTER TABLE ${METRICS_TABLE} ADD COLUMN tags String`);
    }
    const [view] = await db.rows<{ create_table_query: string }>(
      sql`
        SELECT create_table_query FROM system.tables
        WHERE database = ${CLICKHOUSE_DATABASE}
          AND name = 'benemetrics_metrics_mv'
      `,
    );
    if (view && !view.create_table_query.includes("tags")) {
      statements.push(sql`DROP TABLE IF EXISTS ${chTable("benemetrics_metrics_mv")}`);
    }
    statements.push(createMetricsView());
    return statements;
  },
};
