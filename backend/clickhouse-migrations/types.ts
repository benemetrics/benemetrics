import type { SQLQuery } from "waddler";
import type { MigrationDb } from "./db";

// A migration: applied in order, recorded in the migrations table. A
// `needed` probe distinguishes "never ran yet" from "the DB predates the
// migration but is already in the target shape" — the probe runs the DDL
// only when it would actually change something, which keeps the recorded
// history and the physical shape in sync on upgrades without rerunning
// data-preserving work.
export interface ClickHouseMigration {
  /** The recorded name; the leading order prefix sorts the runs. */
  name: string;
  /** Returns true when the statements must run; default true. */
  needed?: (db: MigrationDb) => Promise<boolean>;
  statements: (db: MigrationDb) => Promise<SQLQuery[]> | SQLQuery[];
}
