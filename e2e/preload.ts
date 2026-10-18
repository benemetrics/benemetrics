// This file is loaded by bunfig.toml for e2e tests
// It sets up the test environment

process.env.ADMIN_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
process.env.NATS_SERVERS = "nats://localhost:4222";
process.env.CLICKHOUSE_HOST = "localhost";
process.env.CLICKHOUSE_PORT = "8123";
process.env.S3_BUCKET = "sentry-replays";
process.env.S3_ENDPOINT = "http://localhost:9100";
process.env.S3_ACCESS_KEY_ID = "rustfsadmin";
process.env.S3_SECRET_ACCESS_KEY = "rustfsadmin";
process.env.S3_REGION = "us-east-1";

// Import to trigger bootstrap
import "../backend/index.ts";