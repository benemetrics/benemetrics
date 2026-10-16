/**
 * Test preload: every test file runs the real app against an in-memory
 * PGlite database (see db/index.ts). Close the embedded Postgres client
 * after each file so WASM memory does not accumulate across the suite.
 *
 * Registered from bunfig.toml [test].preload; runs once per test file.
 */
import { afterAll } from "bun:test";
import { closeDb } from "db";

// The backend accepts only the ADMIN_TOKEN configured in the environment,
// so the suite configures one for every test file. Tests that need the
// unconfigured state unset it temporarily and restore it.
process.env.ADMIN_TOKEN = "e2e-admin-token";

afterAll(async () => {
  await closeDb();
});
