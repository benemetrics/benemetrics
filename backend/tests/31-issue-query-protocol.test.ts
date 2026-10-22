/**
 * API Test: the issue query protocol.
 *
 * Exercises every grammar term, the sorts, the cursor pagination and the
 * error cases against the list endpoint.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { handleFetch as fetch, TEST_ORIGIN } from "./test-helpers";
import { issueDAO } from "db/dao/issues";
import { appDAO, projectDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";

const ADMIN_TOKEN = "API-Key e2e-admin-token";
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

interface IssueRow {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: string;
  firstRelease: string | null;
  lastRelease: string | null;
  status: string;
  eventCount: number;
}

interface ListResponse {
  data: IssueRow[];
  meta: { terms: Array<{ kind: string; value: string }>; sort: string };
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${TEST_ORIGIN}${path}`, options);
}

// The test database is shared by the whole suite, so every query is
// scoped to the project this file created.
async function listRaw(query: string, sort?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ query, limit: "50" });
  if (sort) params.set("sort", sort);
  const response = await apiRequest("GET", `/api/admin/issues?${params.toString()}`);
  expect(response.status).toBe(200);
  return (await response.json()) as ListResponse;
}

async function list(terms = "", sort?: string): Promise<ListResponse> {
  const params = new URLSearchParams({
    query: `project:${projectId}${terms ? ` ${terms}` : ""}`,
    limit: "50",
  });
  if (sort) params.set("sort", sort);
  const response = await apiRequest("GET", `/api/admin/issues?${params.toString()}`);
  expect(response.status).toBe(200);
  return (await response.json()) as ListResponse;
}

let appId = "";
let otherAppId = "";
let projectId = "";
let environmentId = "";
let environmentName = "";

beforeAll(async () => {
  const project = await projectDAO.create({
    name: `QueryProj-${uniq()}`,
    slug: `query-proj-${uniq()}`,
    description: "",
  });
  projectId = project.id;
  const environment = await environmentDAO.create({
    projectId,
    name: "Staging",
    slug: `staging-${uniq()}`,
    isDefault: 1,
  });
  environmentId = environment.id;
  environmentName = environment.name;

  const app = await appDAO.create({
    id: crypto.randomUUID(),
    projectId,
    environmentId,
    name: "Query App",
    platform: "javascript",
    ingestKey: `ingest-${uniq()}`,
    publicKey: `public-${uniq()}`,
  });
  appId = app.id;

  const other = await appDAO.create({
    id: crypto.randomUUID(),
    projectId,
    environmentId,
    name: "Other Query App",
    platform: "javascript",
    ingestKey: `ingest-${uniq()}`,
    publicKey: `public-${uniq()}`,
  });
  otherAppId = other.id;

  const now = new Date().toISOString();
  const seed = async (
    targetAppId: string,
    fingerprint: string,
    title: string,
    extra: Record<string, unknown> = {},
  ) => {
    await issueDAO.createIfNew({
      appId: targetAppId,
      fingerprint,
      title,
      culprit: "app.js:12",
      level: "error",
      type: "error",
      firstRelease: "1.0.0",
      lastRelease: "1.0.0",
      eventCount: 5,
      firstSeen: now,
      lastSeen: now,
      latestEventId: crypto.randomUUID(),
      ...extra,
    });
  };

  await seed(appId, "msg:alpha", "Alpha failure");
  await seed(appId, "msg:beta", "Beta failure", { level: "warning" });
  await seed(appId, "msg:gamma", "Gamma failure", { type: "message" });
  await seed(otherAppId, "msg:delta", "Delta failure");
});

describe("Issue query protocol", () => {
  it("lists every issue with the default sort", async () => {
    const result = await list();
    expect(result.data.length).toBe(4);
    expect(result.meta.sort).toBe("new");
  });

  it("filters by status", async () => {
    const unresolved = await list("is:unresolved");
    expect(unresolved.data.length).toBe(4);

    await apiRequest("PATCH", `/api/admin/issues/${(await list("is:unresolved")).data[0]!.id}`, {
      status: "resolved",
    });

    const resolved = await list("is:resolved");
    expect(resolved.data.length).toBe(1);

    const negated = await list("!is:resolved");
    expect(negated.data.length).toBe(3);
  });

  it("filters by app, project and environment", async () => {
    const byApp = await list(`app:${appId}`);
    expect(byApp.data.length).toBe(3);

    const byProject = await list();
    expect(byProject.data.length).toBe(4);

    const byEnvironment = await list(`environment:${environmentName}`);
    expect(byEnvironment.data.length).toBe(4);
  });

  it("filters by the event type", async () => {
    const messages = await list("event.type:message");
    expect(messages.data.length).toBe(1);
    expect(messages.data[0]!.fingerprint).toBe("msg:gamma");
  });

  it("filters by the occurrence count", async () => {
    const more = await list("timesSeen:>4");
    expect(more.data.length).toBe(4);

    const exact = await list("timesSeen:5");
    expect(exact.data.length).toBe(4);

    const fewer = await list("timesSeen:<5");
    expect(fewer.data.length).toBe(0);
  });

  it("filters by the seen timestamps", async () => {
    const future = await list("firstSeen:>2100-01-01");
    expect(future.data.length).toBe(0);

    const past = await list("lastSeen:<2100-01-01");
    expect(past.data.length).toBe(4);

    const relative = await list("lastSeen:-1h");
    expect(relative.data.length).toBe(4);
  });

  it("searches the free text", async () => {
    const byTitle = await list("Alpha");
    expect(byTitle.data.length).toBe(1);
    expect(byTitle.data[0]!.title).toBe("Alpha failure");

    // A literal `key:value` is searched as text when it is quoted.
    const byCulprit = await list('"app.js:12"');
    expect(byCulprit.data.length).toBe(4);

    const negated = await list("!Alpha");
    expect(negated.data.length).toBe(3);
  });

  it("ORs the alternatives", async () => {
    // The second alternative needs a resolved issue in the other app.
    const other = await list(`app:${otherAppId}`);
    await apiRequest("PATCH", `/api/admin/issues/${other.data[0]!.id}`, {
      status: "resolved",
    });

    // The first alternative holds the first app, the second the other one.
    const or = await listRaw(`app:${appId} is:unresolved | app:${otherAppId} is:resolved`);
    const and = await listRaw(`app:${appId} is:unresolved app:${otherAppId} is:resolved`);
    expect(new Set(or.data.map((issue) => issue.appId)).size).toBe(2);
    expect(or.data.length).toBeGreaterThan(and.data.length);
  });

  it("echoes the parsed terms in the meta", async () => {
    const params = new URLSearchParams({
      query: "is:unresolved level:error timesSeen:>4",
    });
    const response = await apiRequest("GET", `/api/admin/issues?${params.toString()}`);
    expect(response.status).toBe(200);
    const result = (await response.json()) as ListResponse;
    expect(result.meta.terms).toEqual([
      { kind: "status", value: "unresolved" },
      { kind: "level", value: "error" },
      { kind: "timesSeen", value: "4" },
    ]);
  });

  it("sorts by frequency and by first seen", async () => {
    const frequent = await list("", "frequent");
    expect(frequent.data.length).toBe(4);

    const firstSeen = await list("", "first-seen");
    expect(firstSeen.data.length).toBe(4);
  });

  it("paginates with a cursor", async () => {
    const scope = encodeURIComponent(`project:${projectId}`);
    const first = await apiRequest("GET", `/api/admin/issues?query=${scope}&limit=2`);
    expect(first.status).toBe(200);
    const page = (await first.json()) as ListResponse;
    expect(page.data.length).toBe(2);

    const second = await apiRequest(
      "GET",
      `/api/admin/issues?query=${scope}&limit=2&cursor=${page.data[1]!.id}`,
    );
    const next = (await second.json()) as ListResponse;
    expect(next.data.length).toBe(2);
    expect(next.data[0]!.id).not.toBe(page.data[0]!.id);
  });

  it("rejects an unknown key, a reserved key and an unknown sort", async () => {
    expect((await apiRequest("GET", "/api/admin/issues?query=nope%3A1")).status).toBe(400);
    expect((await apiRequest("GET", "/api/admin/issues?query=assigned%3Ax")).status).toBe(400);
    // `users` is a real sort now (synced from the issue index); `priority` stays reserved.
    expect((await apiRequest("GET", "/api/admin/issues?query=&sort=priority")).status).toBe(400);
  });

  it("404s an app, project or environment that does not exist", async () => {
    const unknownApp = await apiRequest(
      "GET",
      `/api/admin/issues?query=${encodeURIComponent(`app:${crypto.randomUUID()}`)}`,
    );
    expect(unknownApp.status).toBe(404);

    const unknownProject = await apiRequest(
      "GET",
      `/api/admin/issues?query=${encodeURIComponent(`project:${crypto.randomUUID()}`)}`,
    );
    expect(unknownProject.status).toBe(404);

    const unknownEnvironment = await apiRequest(
      "GET",
      `/api/admin/issues?query=${encodeURIComponent(`environment:${crypto.randomUUID()}`)}`,
    );
    expect(unknownEnvironment.status).toBe(404);
  });
});
