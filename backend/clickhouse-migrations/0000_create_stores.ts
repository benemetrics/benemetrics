import { createEventsTable, createIssueEventsTable, createMetricsTable } from "./_ddl";
import type { ClickHouseMigration } from "./types";

// The event store, its derived issue index and the metric samples.
// ReplacingMergeTree + fsync: duplicates collapse on FINAL reads and an
// acknowledged insert survives a page-cache loss.
export const migration: ClickHouseMigration = {
  name: "0000_create_stores",
  statements: () => [
    createEventsTable(),
    createIssueEventsTable(),
    createMetricsTable(),
  ],
};
