/**
 * E2E Test: Source Map Upload + Symbolication
 *
 * Covers the sentry-cli-compatible Releases API surface
 * (/api/0/projects/:org/:project/...), the admin upload-token
 * mechanism (hashed, per project + environment, rotatable),
 * and best-effort symbolication of ingested events.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { handleFetch as fetch, TEST_ORIGIN, waitForApiGet } from "./test-helpers";

const baseUrl = TEST_ORIGIN;

const ADMIN_HEADERS = {
  Authorization: "Bearer e2e-admin-token",
  "Content-Type": "application/json",
};

// Sentry's API layout is /api/0/projects/{org}/{project}/...
// This backend is single-tenant (no orgs), so any org slug
// is accepted for compatibility.
const ORG = "default";

// A valid version 3 source map. mappings "AAAA;AACA" maps:
//   generated (1,1) -> app.ts (1,1)
//   generated (2,1) -> app.ts (2,1)
const SOURCE_MAP = {
  version: 3,
  file: "app.js",
  sources: ["app.ts"],
  sourcesContent: [
    "function boom() {\n  throw new Error('boom');\n}\n",
  ],
  names: [],
  mappings: "AAAA;AACA",
};

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: ADMIN_HEADERS,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return await fetch(`${baseUrl}${path}`, options);
}

async function uploadRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return await fetch(`${baseUrl}${path}`, options);
}

async function uploadMultipart(
  path: string,
  token: string,
  map: unknown,
  name: string,
  dist?: string,
): Promise<Response> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([JSON.stringify(map)], { type: "application/json" }),
    "app.js.map",
  );
  form.append("name", name);
  if (dist) form.append("dist", dist);

  return await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

// SDKs send events as envelopes: header line, item
// header line, payload line.
function buildEnvelope(event: Record<string, unknown>): string {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
  });
  const payload = JSON.stringify(event);
  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
    length: payload.length,
  });
  return `${header}\n${itemHeader}\n${payload}`;
}

async function ingestEvent(
  projectId: string,
  publicKey: string,
  event: Record<string, unknown>,
): Promise<Response> {
  return await fetch(`${baseUrl}/api/${projectId}/envelope/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `sentry_key=${publicKey}`,
    },
    body: buildEnvelope(event),
  });
}

describe("Source Maps (sentry-cli compatible upload + symbolication)", () => {
  let projectId = "";
  let projectSlug = "";
  let appId = "";
  let environmentId = "";
  let publicKey = "";
  let uploadToken = "";

  beforeAll(async () => {
    // Project -> Environment (shared) -> App
    const projectRes = await adminRequest("POST", "/api/admin/projects", {
      name: "Source Map E2E",
      slug: "smt-e2e",
    });
    expect(projectRes.status).toBe(200);
    const project = (await projectRes.json()) as any;
    projectId = project.id;
    projectSlug = project.slug;

    const appRes = await adminRequest(
      "POST",
      `/api/admin/projects/${projectId}/apps`,
      { name: "web" },
    );
    expect(appRes.status).toBe(200);
    const createdApp = (await appRes.json()) as any;
    appId = createdApp.id;
    publicKey = createdApp.publicKey;

    const envRes = await adminRequest("POST", "/api/admin/environments", {
      projectId,
      name: "Production",
    });
    expect(envRes.status).toBe(200);
    const environment = (await envRes.json()) as any;
    environmentId = environment.id;

    // Upload token scoped to project + app + environment
    const tokenRes = await adminRequest(
      "POST",
      "/api/admin/source-map-tokens",
      { name: "ci", projectId, appId, environmentId },
    );
    expect(tokenRes.status).toBe(200);
    const token = (await tokenRes.json()) as any;
    uploadToken = token.token;
    expect(uploadToken).toMatch(/^smt_/);
  });

  it("lists token metadata without leaking the raw token", async () => {
    const res = await adminRequest("GET", "/api/admin/source-map-tokens");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.length).toBeGreaterThan(0);
    for (const token of body.data) {
      expect(token.token).toBeUndefined();
      expect(token.tokenPrefix).toMatch(/^smt_/);
      expect(token.tokenHash).toBeUndefined();
    }
  });

  it("creates a release like sentry-cli `releases new`", async () => {
    const res = await uploadRequest(
      "POST",
      `/api/0/projects/${ORG}/${projectSlug}/releases/`,
      uploadToken,
      { version: "e2e-1.0.0", ref: "abc123" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.version).toBe("e2e-1.0.0");
    expect(body.ref).toBe("abc123");
  });

  it("uploads a source map like sentry-cli `upload-sourcemaps`", async () => {
    const res = await uploadMultipart(
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      uploadToken,
      SOURCE_MAP,
      "~/dist/app.js.map",
      "web",
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("~/dist/app.js.map");
    expect(body.dist).toBe("web");
    // Byte size is derived from the stored document at read time.
    expect(body.size).toBe(Buffer.byteLength(JSON.stringify(SOURCE_MAP), "utf8"));
  });

  it("records token usage on the token metadata", async () => {
    const res = await adminRequest(
      "GET",
      `/api/admin/source-map-tokens?projectId=${projectId}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const record = body.data.find(
      (token: { tokenPrefix?: string }) =>
        token.tokenPrefix === uploadToken.slice(0, 10),
    );
    expect(record).toBeDefined();
    expect(record.lastUsedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(record.lastUsedAt))).toBe(false);
  });

  it("re-uploading an artifact updates it instead of failing", async () => {
    const res = await uploadMultipart(
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      uploadToken,
      SOURCE_MAP,
      "~/dist/app.js.map",
      "web",
    );
    expect(res.status).toBe(201);

    const listRes = await uploadRequest(
      "GET",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      uploadToken,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(
      listBody.data.filter(
        (artifact: { name?: string }) => artifact.name === "~/dist/app.js.map",
      ),
    ).toHaveLength(1);
  });

  it("rejects upload without a token", async () => {
    const res = await uploadMultipart(
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      "",
      SOURCE_MAP,
      "~/dist/app.js.map",
    );
    expect(res.status).toBe(401);
  });

  it("rejects invalid source map payloads", async () => {
    const invalidJson = await uploadMultipart(
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      uploadToken,
      "not-json",
      "~/dist/broken.js.map",
    );
    expect(invalidJson.status).toBe(400);

    const notAMap = await uploadMultipart(
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      uploadToken,
      { hello: "world" },
      "~/dist/notamap.js.map",
    );
    expect(notAMap.status).toBe(400);
  });

  it("lists and finalizes the release", async () => {
    const listRes = await uploadRequest(
      "GET",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      uploadToken,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.data.length).toBeGreaterThan(0);

    const finalizeRes = await uploadRequest(
      "POST",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/`,
      uploadToken,
    );
    expect(finalizeRes.status).toBe(200);
    const finalized = (await finalizeRes.json()) as any;
    expect(finalized.status).toBe("finalized");
  });

  it("symbolicates ingested events for the release", async () => {
    const eventId = crypto.randomUUID();
    const ingestRes = await ingestEvent(projectId, publicKey, {
      event_id: eventId,
      release: "e2e-1.0.0",
      exception: {
        values: [
          {
            type: "Error",
            stacktrace: {
              frames: [
                { filename: "app.js", lineno: 1, colno: 1, function: "boom" },
                { filename: "app.js", lineno: 2, colno: 1, function: "boom" },
              ],
            },
          },
        ],
      },
    });
    expect(ingestRes.status).toBe(200);

    // Reads apply symbolication at request time; the event itself arrives
    // through NATS -> ClickHouse, so poll for its visibility.
    const event = await waitForApiGet<any>(`/events/${eventId}`);
    expect(event.release).toBe("e2e-1.0.0");

    const frames = event.exception.values[0].stacktrace.frames;
    expect(frames[0].original_filename).toBe("app.ts");
    expect(frames[0].original_lineno).toBe(1);
    expect(frames[0].original_colno).toBe(1);
    expect(frames[0].context_line).toBe("function boom() {");

    expect(frames[1].original_filename).toBe("app.ts");
    expect(frames[1].original_lineno).toBe(2);
    expect(frames[1].context_line).toBe("  throw new Error('boom');");
  });

  it("leaves events without a matching release untouched", async () => {
    const eventId = crypto.randomUUID();
    const ingestRes = await ingestEvent(projectId, publicKey, {
      event_id: eventId,
      release: "e2e-unmapped",
      exception: {
        values: [
          {
            type: "Error",
            stacktrace: {
              frames: [{ filename: "app.js", lineno: 1, colno: 1 }],
            },
          },
        ],
      },
    });
    expect(ingestRes.status).toBe(200);

    const event = await waitForApiGet<any>(`/events/${eventId}`);
    const frame = event.exception.values[0].stacktrace.frames[0];
    expect(frame.original_filename).toBeUndefined();
    expect(frame.filename).toBe("app.js");
  });

  it("enforces per-project token scope", async () => {
    const otherProjectRes = await adminRequest("POST", "/api/admin/projects", {
      name: "Source Map Other",
      slug: "smt-other",
    });
    const otherProject = (await otherProjectRes.json()) as any;

    const otherAppRes = await adminRequest(
      "POST",
      `/api/admin/projects/${otherProject.id}/apps`,
      { name: "web" },
    );
    const otherApp = (await otherAppRes.json()) as any;

    const otherEnvRes = await adminRequest("POST", "/api/admin/environments", {
      projectId: otherProject.id,
      name: "Production",
    });
    const otherEnv = (await otherEnvRes.json()) as any;

    const otherTokenRes = await adminRequest(
      "POST",
      "/api/admin/source-map-tokens",
      {
        name: "ci-other",
        projectId: otherProject.id,
        appId: otherApp.id,
        environmentId: otherEnv.id,
      },
    );
    const otherToken = (await otherTokenRes.json()) as any;

    // Token from the other project cannot upload to this project
    const res = await uploadMultipart(
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      otherToken.token,
      SOURCE_MAP,
      "~/dist/app.js.map",
    );
    expect(res.status).toBe(403);
  });

  it("rotates tokens: old token dies, new token works", async () => {
    const tokenRes = await adminRequest(
      "GET",
      "/api/admin/source-map-tokens",
    );
    const tokens = ((await tokenRes.json()) as any).data;
    const mine = tokens.find(
      (t: any) => t.projectId === projectId && t.environmentId === environmentId && t.name === "ci",
    );
    expect(mine).toBeDefined();

    const rotateRes = await adminRequest(
      "POST",
      `/api/admin/source-map-tokens/${mine.id}/rotate`,
    );
    expect(rotateRes.status).toBe(200);
    const rotated = (await rotateRes.json()) as any;
    expect(rotated.token).toMatch(/^smt_/);

    const oldTokenRes = await uploadRequest(
      "GET",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      uploadToken,
    );
    expect(oldTokenRes.status).toBe(401);

    const newTokenRes = await uploadRequest(
      "GET",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      rotated.token,
    );
    expect(newTokenRes.status).toBe(200);

    uploadToken = rotated.token;
  });

  it("revokes tokens on delete", async () => {
    const tokenRes = await adminRequest(
      "POST",
      "/api/admin/source-map-tokens",
      { name: "temp", projectId, appId, environmentId },
    );
    const temp = (await tokenRes.json()) as any;

    const beforeRes = await uploadRequest(
      "GET",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      temp.token,
    );
    expect(beforeRes.status).toBe(200);

    const revokeRes = await adminRequest(
      "DELETE",
      `/api/admin/source-map-tokens/${temp.id}`,
    );
    expect(revokeRes.status).toBe(200);

    const afterRes = await uploadRequest(
      "GET",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      temp.token,
    );
    expect(afterRes.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const tokenRes = await adminRequest(
      "POST",
      "/api/admin/source-map-tokens",
      {
        name: "expired",
        projectId,
        appId,
        environmentId,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    );
    expect(tokenRes.status).toBe(200);
    const expired = (await tokenRes.json()) as any;

    const res = await uploadRequest(
      "GET",
      `/api/0/projects/${ORG}/${projectSlug}/releases/e2e-1.0.0/files/`,
      expired.token,
    );
    expect(res.status).toBe(401);
  });

  it("hides map content from admin listings unless requested", async () => {
    const listRes = await adminRequest("GET", "/api/admin/source-maps");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.data.length).toBeGreaterThan(0);
    for (const artifact of listBody.data) {
      expect(artifact.mapJson).toBeUndefined();
    }

    const id = listBody.data[0].id;
    const metaRes = await adminRequest(
      "GET",
      `/api/admin/source-maps/${id}`,
    );
    const meta = (await metaRes.json()) as any;
    expect(meta.mapJson).toBeUndefined();

    const contentRes = await adminRequest(
      "GET",
      `/api/admin/source-maps/${id}?include=content`,
    );
    const withContent = (await contentRes.json()) as any;
    expect(withContent.mapJson).toContain('"mappings"');
  });

  it("resolves positions via the admin debug endpoint", async () => {
    const res = await adminRequest("POST", "/api/admin/source-maps/resolve", {
      projectId,
      release: "e2e-1.0.0",
      filename: "app.js",
      line: 2,
      column: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.original.source).toBe("app.ts");
    expect(body.original.line).toBe(2);
    expect(body.original.contextLine).toBe("  throw new Error('boom');");
  });
});
