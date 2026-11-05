import { sql } from "waddler/clickhouse";
import { CLICKHOUSE_DATABASE, EVENTS_TABLE_NAME } from "./_ddl";
import type { MigrationDb } from "./db";

// The lifetime read back from a table definition: null when the table
// carries no retention (or does not exist). ClickHouse writes the TTL
// expression into the stored CREATE TABLE query.
export async function readEventsInterval(
  db: MigrationDb,
): Promise<{ amount: number; unit: "day" | "week" | "month" | "year" } | null> {
  const [table] = await db.rows<{ create_table_query: string }>(
    sql`
      SELECT create_table_query FROM system.tables
      WHERE database = ${CLICKHOUSE_DATABASE} AND name = ${EVENTS_TABLE_NAME}
    `,
  );
  const match = /\btoInterval(Month|Week|Day|Year)\((\d+)\)/i.exec(
    table?.create_table_query ?? "",
  );
  if (!match) return null;
  return {
    amount: Number(match[2]),
    unit: match[1]!.toLowerCase() as "day" | "week" | "month" | "year",
  };
}
