import { createClient } from "@clickhouse/client";
import { env } from "bun";

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || "localhost",
  port: parseInt(process.env.CLICKHOUSE_PORT || "8123"),
  database: process.env.CLICKHOUSE_DATABASE || "default",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
});

export async function initClickHouse(): Promise<void> {
  // Create events table via NATS engine
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS nats_events (
        id String,
        projectId String,
        appId String,
        envelopeHeader String,
        envelopeItems String,
        receivedAt String,
        type String
      ) ENGINE = NATS SETTINGS
        nats_url='${process.env.NATS_SERVERS || "nats://localhost:4222"}',
        nats_stream='${process.env.NATS_STREAM || "SENTRIES"}',
        nats_consumer_name='clickhouse-events',
        nats_subjects='sentry.events',
        nats_format='JSONEachRow',
        input_format_skip_unknown_fields=1,
        nats_skip_broken_messages=10
    `,
  });

  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS sentry_events (
        id String,
        projectId String,
        appId String,
        envelopeHeader String,
        envelopeItems String,
        receivedAt DateTime64(3)
      ) ENGINE = ReplacingMergeTree()
      ORDER BY (projectId, receivedAt, id)
      SETTINGS fsync_after_insert=1, fsync_part_directory=1
      TTL toDateTime(receivedAt) + toIntervalMonth(1)
    `,
  });

  await client.exec({
    query: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS sentry_events_mv TO sentry_events AS
      SELECT id, projectId, appId, envelopeHeader, envelopeItems,
             parseDateTimeBestEffort(receivedAt) AS receivedAt
      FROM nats_events WHERE type != 'clear'
    `,
  });

  // Metrics tables
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS nats_metrics (
        eventId String,
        projectId String,
        appId String,
        metric String,
        value Float64,
        dimension String,
        timestamp String
      ) ENGINE = NATS SETTINGS
        nats_url='${process.env.NATS_SERVERS || "nats://localhost:4222"}',
        nats_stream='${process.env.NATS_STREAM || "SENTRIES"}',
        nats_consumer_name='clickhouse-metrics',
        nats_subjects='sentry.metrics',
        nats_format='JSONEachRow',
        input_format_skip_unknown_fields=1,
        nats_skip_broken_messages=10
    `,
  });

  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS sentry_metrics (
        eventId String,
        projectId String,
        appId String,
        metric String,
        value Float64,
        dimension String,
        timestamp DateTime64(3)
      ) ENGINE = ReplacingMergeTree()
      ORDER BY (projectId, timestamp, eventId)
      SETTINGS fsync_after_insert=1, fsync_part_directory=1
    `,
  });

  await client.exec({
    query: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS sentry_metrics_mv TO sentry_metrics AS
      SELECT eventId, projectId, appId, metric, value, dimension,
             parseDateTimeBestEffort(timestamp) AS timestamp
      FROM nats_metrics
    `,
  });

  console.log("ClickHouse initialized");
}

export { client as clickhouseClient };