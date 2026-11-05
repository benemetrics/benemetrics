import type { ClickHouseDialect, SQLQuery } from "waddler";

// The migrations run through the store's own retry/circuit-breaker path;
// the runner hands this in instead of the migrations importing clickhouse.ts
// (which would be the cycle this folder is built around).
export interface MigrationDb {
  /** Executes a statement without a result set (DDL, INSERT, TRUNCATE). */
  command(statement: SQLQuery<ClickHouseDialect>): Promise<void>;
  /** Executes a SELECT and returns its rows in the object row mode. */
  rows<T>(statement: SQLQuery<ClickHouseDialect>): Promise<T[]>;
}
