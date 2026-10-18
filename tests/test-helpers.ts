/**
 * Shared helpers for in-process API tests.
 *
 * Requests go straight through `app.handle(new Request(...))`: no listener,
 * no port, no teardown. Suites that need a real socket — SDK-driven tests,
 * WebView UI tests, WebSocket feeds — keep using `e2e/test-helpers.ts`.
 */

import app from "../backend/index";

/** Canonical origin for in-process requests; DSN hosts derive from it. */
export const TEST_ORIGIN = "http://test.local";

export const ADMIN_TOKEN = "Bearer e2e-admin-token";

export const ADMIN_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Authorization: ADMIN_TOKEN,
};

/** fetch-shaped, but routed through `app.handle` (no network). */
export function handleFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (input instanceof Request) return app.handle(input);

  // No network hop means no automatic Host header; set it so request-derived
  // values (e.g. app DSN hosts) stay consistent with the URL the test used.
  const url = new URL(String(input), TEST_ORIGIN);
  const headers = new Headers(init?.headers);
  if (!headers.has("host")) headers.set("host", url.host);
  return app.handle(new Request(url, { ...init, headers }));
}

export interface TestApp {
  baseUrl: string;
  dsn: string;
  projectId: string;
  appId: string;
}

/** Provisions a project + app through the admin API (no server started). */
export async function startTestApp(): Promise<TestApp> {
  const projectResponse = await handleFetch(`${TEST_ORIGIN}/api/admin/projects`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: `E2E Project ${crypto.randomUUID().slice(0, 8)}` }),
  });
  if (!projectResponse.ok) {
    throw new Error(`Failed to create test project: ${projectResponse.status}`);
  }
  const project = (await projectResponse.json()) as { id: string };

  const appResponse = await handleFetch(`${TEST_ORIGIN}/api/admin/projects/${project.id}/apps`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: "E2E App" }),
  });
  if (!appResponse.ok) {
    throw new Error(`Failed to create test app: ${appResponse.status}`);
  }
  const created = (await appResponse.json()) as { id: string; dsn: string };

  return { baseUrl: TEST_ORIGIN, dsn: created.dsn, projectId: project.id, appId: created.id };
}

/** Polls `fn` until `predicate` passes; returns the last observed value. */
export async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  let last!: T;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await Bun.sleep(100);
  }
  return last;
}
