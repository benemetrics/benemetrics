/**
 * E2E Test: Releases
 *
 * Releases are auto-created when an ingested event carries a release
 * version that is not attached yet, and their metrics (firstSeen,
 * lastSeen, eventCount, latestEventId) are maintained as events arrive.
 *
 * Covers:
 *   - Auto-creation on ingestion (store + envelope endpoints)
 *   - Metric updates on subsequent events for the same version
 *   - One release row per version per app
 *   - Explicit creation (sentry-cli "releases new") merging with events
 *   - Duplicate version rejection, finalize, CRUD, pagination
 *   - Per-release issue summary (new / regressed issues)
 *   - Cascade delete when the owning app is deleted
 * Starts a real server on an ephemeral port for testing.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

let baseUrl = "";
let server: any;

const ADMIN_TOKEN = "Bearer e2e-admin-token";
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ReleaseResponse {
  id: string;
  appId: string;
  version: string;
  ref: string | null;
  url: string | null;
  owner: string | null;
  status: string;
  firstSeen: string | null;
  lastSeen: string | null;
  eventCount: number;
  latestEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReleaseIssueMetric {
  fingerprint: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isRegressed: boolean;
}

interface ReleaseSummaryResponse extends ReleaseResponse {
  issueCount: number;
  newIssueCount: number;
  regressedIssueCount: number;
  issues: ReleaseIssueMetric[];
}

interface ReleaseListResponse {
  data: ReleaseResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token: string = ADMIN_TOKEN,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return await fetch(`${baseUrl}${path}`, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// Creates a fresh project + app and returns ids plus the ingest key.
async function makeApp(): Promise<{ projectId: string; appId: string; publicKey: string }> {
  const project = await json<{ id: string }>(
    await apiRequest("POST", "/api/admin/projects", { name: `RelProj-${uniq()}` }),
  );
  const appRecord = await json<{ id: string; publicKey: string }>(
    await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
      name: `RelApp-${uniq()}`,
      host: "localhost:31337",
    }),
  );
  return { projectId: project.id, appId: appRecord.id, publicKey: appRecord.publicKey };
}

// Ingests an event through the store endpoint (JSON body, sentry_key auth).
async function ingestStore(
  projectId: string,
  publicKey: string,
  event: Record<string, unknown>,
): Promise<Response> {
  return await fetch(
    `${baseUrl}/api/${projectId}/store/?sentry_key=${encodeURIComponent(publicKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );
}

// Ingests a raw Sentry envelope through the envelope endpoint.
async function ingestEnvelope(
  projectId: string,
  publicKey: string,
  event: Record<string, unknown>,
): Promise<Response> {
  const raw = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event", content_type: "application/json" }),
    JSON.stringify(event),
  ].join("\n");

  return await fetch(
    `${baseUrl}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(publicKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    },
  );
}

async function createRelease(
  appId: string,
  version: string,
  extra?: { ref?: string; url?: string; owner?: string },
): Promise<ReleaseResponse> {
  return await json<ReleaseResponse>(
    await apiRequest("POST", "/api/admin/releases", { appId, version, ...extra }),
  );
}

async function listReleases(appId: string, query = ""): Promise<ReleaseListResponse> {
  return await json<ReleaseListResponse>(
    await apiRequest("GET", `/api/admin/releases?appId=${appId}${query}`),
  );
}

// Release metrics are maintained by a parallel NATS consumer
// (in-process fallback when NATS is unavailable), so ingest
// assertions must poll until the release row is updated.
async function waitForRelease(
  appId: string,
  version: string,
  options?: { eventCount?: number; timeoutMs?: number },
): Promise<ReleaseResponse> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const start = Date.now();
  for (;;) {
    const { data } = await listReleases(appId);
    const release = data.find((r) => r.version === version);
    if (
      release &&
      (options?.eventCount === undefined || release.eventCount >= options.eventCount)
    ) {
      return release;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Release not found: ${version}${
          options?.eventCount !== undefined ? ` (eventCount >= ${options.eventCount})` : ""
        }`,
      );
    }
    await sleep(50);
  }
}

describe("Releases (auto-created from ingestion)", () => {
  beforeAll(async () => {
    app.listen(0);
    server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  it("auto-creates a release when an event with a new version is ingested", async () => {
    const { projectId, appId, publicKey } = await makeApp();
    const eventId = crypto.randomUUID();

    const response = await ingestStore(projectId, publicKey, {
      event_id: eventId,
      release: "1.0.0",
      message: "boom",
    });
    expect(response.status).toBe(200);

    const release = await waitForRelease(appId, "1.0.0");
    expect(release.version).toBe("1.0.0");
    expect(release.appId).toBe(appId);
    expect(release.status).toBe("draft");
    expect(release.eventCount).toBe(1);
    expect(release.latestEventId).toBe(eventId);
    expect(release.firstSeen).toBeTypeOf("string");
    expect(release.lastSeen).toBe(release.firstSeen);
  });

  it("updates metrics as more events for the same version arrive", async () => {
    const { projectId, appId, publicKey } = await makeApp();

    const first = crypto.randomUUID();
    await ingestStore(projectId, publicKey, { event_id: first, release: "2.0.0", message: "one" });
    await sleep(10);
    const second = crypto.randomUUID();
    await ingestStore(projectId, publicKey, { event_id: second, release: "2.0.0", message: "two" });

    const release = await waitForRelease(appId, "2.0.0", { eventCount: 2 });
    expect(release.eventCount).toBe(2);
    expect(release.latestEventId).toBe(second);
    expect(release.firstSeen).toBeTypeOf("string");
    expect(release.lastSeen).toBeTypeOf("string");
    expect(String(release.firstSeen) <= String(release.lastSeen)).toBe(true);
  });

  it("creates a separate release row for each version", async () => {
    const { projectId, appId, publicKey } = await makeApp();

    await ingestStore(projectId, publicKey, { event_id: crypto.randomUUID(), release: "3.0.0" });
    await ingestStore(projectId, publicKey, { event_id: crypto.randomUUID(), release: "3.1.0" });
    await ingestStore(projectId, publicKey, { event_id: crypto.randomUUID(), release: "3.0.0" });

    const v30 = await waitForRelease(appId, "3.0.0", { eventCount: 2 });
    const v31 = await waitForRelease(appId, "3.1.0", { eventCount: 1 });
    expect(v30.eventCount).toBe(2);
    expect(v31.eventCount).toBe(1);

    const { data, pagination } = await listReleases(appId);
    expect(data).toHaveLength(2);
    expect(pagination.total).toBe(2);
  });

  it("tracks releases sent through the envelope endpoint", async () => {
    const { projectId, appId, publicKey } = await makeApp();
    const eventId = crypto.randomUUID();

    const response = await ingestEnvelope(projectId, publicKey, {
      event_id: eventId,
      release: "4.0.0",
      message: "via envelope",
    });
    expect(response.status).toBe(200);

    const release = await waitForRelease(appId, "4.0.0");
    expect(release.eventCount).toBe(1);
    expect(release.latestEventId).toBe(eventId);
  });

  it("ignores events without a release field", async () => {
    const { projectId, appId, publicKey } = await makeApp();

    const response = await ingestStore(projectId, publicKey, {
      event_id: crypto.randomUUID(),
      message: "no release",
    });
    expect(response.status).toBe(200);

    const { data } = await listReleases(appId);
    expect(data).toHaveLength(0);
  });

  it("merges ingested events into an explicitly created release", async () => {
    const { projectId, appId, publicKey } = await makeApp();

    const created = await createRelease(appId, "5.0.0", {
      ref: "abc123def",
      url: "https://example.com/releases/5.0.0",
      owner: "ci@company.com",
    });
    expect(created.eventCount).toBe(0);
    expect(created.firstSeen).toBeNull();

    const eventId = crypto.randomUUID();
    await ingestStore(projectId, publicKey, { event_id: eventId, release: "5.0.0", message: "deployed" });

    const release = await waitForRelease(appId, "5.0.0", { eventCount: 1 });
    expect(release.id).toBe(created.id);
    expect(release.eventCount).toBe(1);
    expect(release.latestEventId).toBe(eventId);
    expect(release.firstSeen).toBeTypeOf("string");
    expect(release.ref).toBe("abc123def");
    expect(release.url).toBe("https://example.com/releases/5.0.0");
    expect(release.owner).toBe("ci@company.com");
  });

  it("rejects a duplicate version for the same app", async () => {
    const { appId } = await makeApp();

    await createRelease(appId, "6.0.0");
    const response = await apiRequest("POST", "/api/admin/releases", { appId, version: "6.0.0" });
    expect(response.status).toBe(409);
  });

  it("resolves concurrent creates of the same version with a single winner", async () => {
    const { appId } = await makeApp();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        apiRequest("POST", "/api/admin/releases", { appId, version: "8.0.0" }),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);

    const releases = await listReleases(appId);
    expect(
      releases.data.filter((release) => release.version === "8.0.0"),
    ).toHaveLength(1);
  });

  it("finalizes a release", async () => {
    const { appId } = await makeApp();
    const created = await createRelease(appId, "7.0.0");

    const finalized = await json<ReleaseResponse>(
      await apiRequest("POST", `/api/admin/releases/${created.id}/finalize`),
    );
    expect(finalized.status).toBe("finalized");
  });

  it("returns 404 for an unknown release", async () => {
    const response = await apiRequest("GET", `/api/admin/releases/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
  });

  it("deletes a release", async () => {
    const { appId } = await makeApp();
    const created = await createRelease(appId, "8.0.0");

    const response = await apiRequest("DELETE", `/api/admin/releases/${created.id}`);
    expect(response.status).toBe(200);

    const after = await apiRequest("GET", `/api/admin/releases/${created.id}`);
    expect(after.status).toBe(404);
  });

  it("paginates the release list", async () => {
    const { appId } = await makeApp();

    await createRelease(appId, "9.0.0");
    await createRelease(appId, "9.1.0");
    await createRelease(appId, "9.2.0");

    const page1 = await listReleases(appId, "&limit=2&page=1");
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.totalPages).toBe(2);

    const page2 = await listReleases(appId, "&limit=2&page=2");
    expect(page2.data).toHaveLength(1);
  });

  it("summarizes new and regressed issues per release", async () => {
    const { projectId, appId, publicKey } = await makeApp();
    const tag = uniq();

    await ingestStore(projectId, publicKey, {
      event_id: crypto.randomUUID(),
      release: "6.0.0",
      message: `Payment failed ${tag}`,
    });
    await sleep(5);
    await ingestStore(projectId, publicKey, {
      event_id: crypto.randomUUID(),
      release: "6.0.0",
      message: `Null pointer ${tag}`,
    });
    await sleep(5);
    await ingestStore(projectId, publicKey, {
      event_id: crypto.randomUUID(),
      release: "6.1.0",
      message: `Payment failed ${tag}`,
    });
    await sleep(5);
    await ingestStore(projectId, publicKey, {
      event_id: crypto.randomUUID(),
      release: "6.1.0",
      message: `Timeout ${tag}`,
    });

    const v60 = await waitForRelease(appId, "6.0.0", { eventCount: 2 });
    const v61 = await waitForRelease(appId, "6.1.0", { eventCount: 2 });

    const summary61 = await json<ReleaseSummaryResponse>(
      await apiRequest("GET", `/api/admin/releases/${v61.id}/summary`),
    );
    expect(summary61.issueCount).toBe(2);
    expect(summary61.newIssueCount).toBe(1);
    expect(summary61.regressedIssueCount).toBe(1);

    const regressed = summary61.issues.find((issue) => issue.isRegressed);
    expect(regressed?.fingerprint).toContain(`Payment failed ${tag}`);

    const summary60 = await json<ReleaseSummaryResponse>(
      await apiRequest("GET", `/api/admin/releases/${v60.id}/summary`),
    );
    expect(summary60.issueCount).toBe(2);
    expect(summary60.newIssueCount).toBe(2);
    expect(summary60.regressedIssueCount).toBe(0);
  });

  it("cascades to releases when the owning app is deleted", async () => {
    const { projectId, appId, publicKey } = await makeApp();

    await ingestStore(projectId, publicKey, {
      event_id: crypto.randomUUID(),
      release: "10.0.0",
      message: "doomed",
    });
    const release = await waitForRelease(appId, "10.0.0");

    const response = await apiRequest("DELETE", `/api/admin/apps/${appId}`);
    expect(response.status).toBe(200);

    const after = await apiRequest("GET", `/api/admin/releases/${release.id}`);
    expect(after.status).toBe(404);
  });
});
