import { sql } from "waddler/clickhouse";
import {
  CLICKHOUSE_DATABASE,
  DEFAULT_EVENTS_TTL,
  EVENTS_TABLE,
  ISSUE_EVENTS_TABLE,
  METRICS_TABLE,
  ttlExpression,
} from "./_ddl";
import { readEventsInterval } from "./ttl";
import type { MigrationDb } from "./db";
import type { ClickHouseMigration } from "./types";

// The events and the metric samples share one lifetime. Boot seeds the
// default only when the table carries no TTL at all — an admin's retention
// (also "no retention") is never overwritten afterwards. `REMOVE TTL`
// leaves an installation without a lifetime; from then on boot never
// reseeds it because this migration is recorded as applied once.
export const migration: ClickHouseMigration = {
  name: "0006_events_ttl",
  statements: async (db) => {
    if (await readEventsInterval(db)) return [];
    const expression = ttlExpression(
      DEFAULT_EVENTS_TTL.amount,
      DEFAULT_EVENTS_TTL.unit,
    );
    return [EVENTS_TABLE, METRICS_TABLE, ISSUE_EVENTS_TABLE].map((table) =>
      sql`ALTER TABLE ${table} MODIFY TTL ${sql.raw(expression)}`,
    );
  },
};
