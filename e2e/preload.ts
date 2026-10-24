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
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The test environment comes first: the backend reads the settings at
// import time.
import "./test-env";
// The identity provider stub configures OIDC_* at import time: the backend
// discovers the provider when it boots, so it must come before any backend
// module is loaded.
import "./oidc-provider";
import { closeDb } from "db";
import { closeClickHouse, initClickHouse } from "../backend/clickhouse";
// Importing the consumer starts its `sentry.events` subscription in this
// process, so the side effects land in this file's in-memory PGlite.
import "../backend/consumer";
import { mock } from "bun:test";
import * as realAdminToken from "../backend/admin-token";

// The object store is S3-required. The suite runs against the compose
// RustFS (`docker compose up -d rustfs rustfs-init`); these defaults are
// applied before any test file imports the storage module, so they are the
// effective configuration (CI can override the S3_* values).
process.env.S3_BUCKET ??= "sentry-replays";
process.env.S3_ENDPOINT ??= "http://localhost:9100";
process.env.S3_ACCESS_KEY_ID ??= "rustfsadmin";
process.env.S3_SECRET_ACCESS_KEY ??= "rustfsadmin";
process.env.S3_REGION ??= "us-east-1";

// Pin the in-memory admin token for deterministic e2e testing; no test
// hook exists in the production module.
mock.module("../backend/admin-token", () => ({
  ...realAdminToken,
  currentAdminToken: () => "e2e-admin-token",
}));

// Bun's WebView leaves its Chrome profile in the temp directory; a suite
// leaves hundreds behind, and a full temp filesystem makes Chrome abort on
// start. The profiles are per-run scratch space, so they are cleared
// before the next file opens its WebView.
function clearWebViewProfiles(): void {
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.includes(".bun-chrome")) continue;
      rmSync(join(tmpdir(), entry), { recursive: true, force: true });
    }
  } catch {
    // The cleanup is best-effort.
  }
}

beforeAll(async () => {
  clearWebViewProfiles();
  await initClickHouse();
});

afterAll(async () => {
  await closeClickHouse();
  await closeDb();
});
