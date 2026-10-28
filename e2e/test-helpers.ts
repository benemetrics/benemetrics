/**
 * Shared helpers for listener-needing e2e suites (SDK-driven tests, WebView
 * UI tests); in-process API tests live in `backend/tests/` and use
 * `backend/tests/test-helpers.ts` instead.
 *
 * Starts the real backend on an ephemeral port and provisions a project +
 * app through the admin API. Ingestion never auto-creates apps anymore, so
 * SDK-based tests need a real DSN.
 */

// The admin token is generated at boot and `generateAdminToken()` prints it
// on stdout. Intercept console.log before loading the backend so the suite
// authenticates against the printed token instead of a hardcoded fixture.
const originalLog = console.log.bind(console);
let printedToken = "";
console.log = (...args: unknown[]) => {
  for (const arg of args) {
    const match = String(arg).match(/\bbnm_[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}\b/);
    if (match) printedToken = match[0];
  }
  return originalLog(...args);
};

const { default: app } = await import("../backend/index");
console.log = originalLog;

export { app };

if (!printedToken) {
  throw new Error("admin token was not printed at boot");
}

app.store.adminTokenHash = await Bun.password.hash(printedToken);

export const ADMIN_TOKEN_RAW = printedToken;
export const ADMIN_TOKEN = `API-Key ${printedToken}`;

export const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  Authorization: ADMIN_TOKEN,
};

/** Polls `fn` until the predicate holds; returns the last value either way. */
export async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return await fn();
}

// Ingestion is asynchronous (NATS -> ClickHouse): fetches wait for the
// event to become visible instead of racing the pipeline.
export async function waitForEventById(
  baseUrl: string,
  eventId: string,
  timeoutMs = 10000,
): Promise<Record<string, any> | null> {
  return await waitFor(
    async () => {
      const response = await fetch(`${baseUrl}/events/${eventId}`, {
        headers: ADMIN_HEADERS,
      });
      if (response.status === 404) return null;
      return (await response.json()) as Record<string, any>;
    },
    (value) => value !== null,
    timeoutMs,
  );
}

/** Polls the events list until an item matches; returns the item or null. */
export async function waitForEventListItem<
  T extends { id: string; itemTypes: string[] } = { id: string; itemTypes: string[] },
>(
  baseUrl: string,
  predicate: (item: T) => boolean,
  timeoutMs = 10000,
  appId?: string,
): Promise<T | null> {
  const query = appId
    ? `?limit=100&appId=${encodeURIComponent(appId)}`
    : "?limit=100";
  return await waitFor(
    async () => {
      const response = await fetch(`${baseUrl}/events${query}`, {
        headers: ADMIN_HEADERS,
      });
      const body = (await response.json()) as { data?: T[] };
      return (body.data ?? []).find(predicate) ?? null;
    },
    (value) => value !== null,
    timeoutMs,
  );
}

export interface TestServer {
  baseUrl: string;
  dsn: string;
  projectId: string;
  appId: string;
  stop: () => void;
}

export async function startTestServer(): Promise<TestServer> {
  app.listen(0);
  const server = (app as any).server;
  const baseUrl = `http://localhost:${server.port}`;

  const projectResponse = await fetch(`${baseUrl}/api/admin/projects`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: `E2E Project ${crypto.randomUUID().slice(0, 8)}` }),
  });
  if (!projectResponse.ok) {
    throw new Error(`Failed to create test project: ${projectResponse.status}`);
  }
  const project = (await projectResponse.json()) as { id: string };

  const appResponse = await fetch(`${baseUrl}/api/admin/projects/${project.id}/apps`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: "E2E App" }),
  });
  if (!appResponse.ok) {
    throw new Error(`Failed to create test app: ${appResponse.status}`);
  }
  const created = (await appResponse.json()) as {
    id: string;
    number: number;
    publicKey: string;
  };

  return {
    baseUrl,
    dsn: `http://${created.publicKey}@${new URL(baseUrl).host}/${created.number}`,
    projectId: project.id,
    appId: created.id,
    stop: () => server?.stop(true),
  };
}
