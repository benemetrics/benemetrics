import { migration as legacyEventsShape } from "./0001_legacy_events_shape";
import { migration as createStores } from "./0000_create_stores";
import { migration as engineTables } from "./0002_engine_tables";
import { migration as eventsMv } from "./0003_events_mv";
import { migration as issueEventsTags } from "./0004_issue_events_tags";
import { migration as metricsTags } from "./0005_metrics_tags";
import { migration as eventsTtl } from "./0006_events_ttl";

// The ClickHouse schema, in the order the migrations apply.
export const CLICKHOUSE_MIGRATIONS = [
  createStores,
  legacyEventsShape,
  engineTables,
  eventsMv,
  issueEventsTags,
  metricsTags,
  eventsTtl,
];

export { readEventsInterval } from "./ttl";
export type { ClickHouseMigration } from "./types";
export type { MigrationDb } from "./db";
