import type { SQLQuery } from "waddler";
import { sql } from "waddler/clickhouse";
import {
  CLICKHOUSE_DATABASE,
  ISSUE_EVENTS_TABLE,
  createIssueEventsView,
  chTable,
} from "./_ddl";
import type { MigrationDb } from "./db";
import type { ClickHouseMigration } from "./types";

// The issue index carries the occurrence's tags; the column and the view
// are added to an existing installation.
export const migration: ClickHouseMigration = {
  name: "0004_issue_events_tags",
  statements: async (db) => {
    const statements: SQLQuery[] = [];
    const [column] = await db.rows<{ name: string }>(
      sql`
        SELECT name FROM system.columns
        WHERE database = ${CLICKHOUSE_DATABASE}
          AND table = 'benemetrics_issue_events' AND name = 'tags'
      `,
    );
    if (!column) {
      statements.push(sql`ALTER TABLE ${ISSUE_EVENTS_TABLE} ADD COLUMN tags String`);
    }
    // The view is recreated when it predates the tags column.
    const [view] = await db.rows<{ create_table_query: string }>(
      sql`
        SELECT create_table_query FROM system.tables
        WHERE database = ${CLICKHOUSE_DATABASE}
          AND name = 'benemetrics_issue_events_mv'
      `,
    );
    if (
      view &&
      !view.create_table_query.includes("JSONExtractRaw(digest, 'tags')")
    ) {
      statements.push(sql`DROP TABLE IF EXISTS ${chTable("benemetrics_issue_events_mv")}`);
    }
    statements.push(createIssueEventsView());
    return statements;
  },
};
