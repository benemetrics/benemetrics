/**
 * Test preload: every test file runs the real app against an in-memory
 * PGlite database (see db/index.ts) and the real NATS + ClickHouse
 * services the suite requires (see todo.metrics.md). Connections are
 * opened before each file and closed after it so WASM memory and sockets
 * do not accumulate across the suite.
 *
 * Registered from bunfig.toml [test].preload; runs once per test file.
 */
import { afterAll, beforeAll } from "bun:test";
import { closeDb } from "db";
import { closeClickHouse, initClickHouse } from "../backend/clickhouse";
import { closeNats, initNats } from "../backend/nats";

// The backend accepts only the ADMIN_TOKEN configured in the environment,
// so the suite configures one for every test file. Tests that need the
// unconfigured state unset it temporarily and restore it.
process.env.ADMIN_TOKEN = "e2e-admin-token";

beforeAll(async () => {
  // Boot order: NATS (stream + durable pull consumers) before ClickHouse
  // (engine tables + materialized views).
  await initNats();
  await initClickHouse();
});

afterAll(async () => {
  await closeNats();
  await closeClickHouse();
  await closeDb();
});
