import { sql } from "waddler/clickhouse";
import {
  CLICKHOUSE_DATABASE,
  legacyEventsMigrationStatements,
  DEFAULT_EVENTS_TTL,
} from "./_ddl";
import { readEventsInterval } from "./ttl";
import type { MigrationDb } from "./db";
import type { ClickHouseMigration } from "./types";

// The rebuilt table keeps the retention the old table carried.
async function previousTtlInterval(db: MigrationDb) {
  return (await readEventsInterval(db)) ?? DEFAULT_EVENTS_TTL;
}

// Data-preserving engine migration: the original `benemetrics_events` was a
// plain MergeTree keyed in seconds precision; the current shape is a
// ReplacingMergeTree keyed by (projectId, receivedAt, id) with millisecond
// timestamps so redelivered messages collapse and events inside the same
// second keep a stable order. Existing rows are copied over (deduplicated
// by id); the retention is carried over.
export const migration: ClickHouseMigration = {
  name: "0001_legacy_events_shape",
  needed: async (db: MigrationDb) => {
    const [table] = await db.rows<{ engine: string }>(
      sql`
        SELECT engine FROM system.tables
        WHERE database = ${CLICKHOUSE_DATABASE} AND name = 'benemetrics_events'
      `,
    );
    if (!table) return false;
    const [receivedAt] = await db.rows<{ type: string }>(
      sql`
        SELECT type FROM system.columns
        WHERE database = ${CLICKHOUSE_DATABASE}
          AND table = 'benemetrics_events' AND name = 'receivedAt'
      `,
    );
    return !(
      table.engine === "ReplacingMergeTree" &&
      receivedAt?.type === "DateTime64(3)"
    );
  },
  statements: async (db) =>
    legacyEventsMigrationStatements(await previousTtlInterval(db)),
};
