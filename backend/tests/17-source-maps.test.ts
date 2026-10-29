/**
 * API Test: Source Maps (sentry-cli compatible upload + symbolication)
 *
 * Upload tokens are scoped to a project + app. Source map artifacts are
 * attached to a release for symbolication.
 * Runs in-process through app.handle (no listener, no port).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  ADMIN_HEADERS,
  handleFetch as fetch,
  TEST_ORIGIN,
} from "./test-helpers";

const baseUrl = TEST_ORIGIN;

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...ADMIN_HEADERS },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, options);
}

describe("Source Maps (sentry-cli compatible upload + symbolication)", () => {
  let projectId = "";
  let projectSlug = "";
  let appId = "";
  let publicKey = "";
  let uploadToken = "";

  beforeAll(async () => {
    // Project -> App
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

    // Upload token scoped to project + app
    const tokenRes = await adminRequest(
      "POST",
      "/api/admin/source-map-tokens",
      { name: "ci", projectId, appId },
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

  it("returns upload-token metadata by id without leaking the raw token", async () => {
    const listRes = await adminRequest(
      "GET",
      `/api/admin/source-map-tokens?projectId=${projectId}`,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.data.length).toBeGreaterThan(0);
    for (const token of listBody.data) {
      expect(token.projectId).toBe(projectId);
    }

    const record = listBody.data.find(
      (token: { tokenPrefix?: string }) =>
        token.tokenPrefix === uploadToken.slice(0, 8),
    );
    expect(record).toBeDefined();

    const byId = await adminRequest(
      "GET",
      `/api/admin/source-map-tokens/${record.id}`,
    );
    expect(byId.status).toBe(200);
    const byIdBody = (await byId.json()) as any;
    expect(byIdBody.token).toBeUndefined();
    expect(byIdBody.tokenPrefix).toBe(record.tokenPrefix);
  });

  it("rejects tokens for unknown projects and apps", async () => {
    const badProject = await adminRequest(
      "POST",
      "/api/admin/source-map-tokens",
      { name: "bad", projectId: crypto.randomUUID(), appId },
    );
    expect(badProject.status).toBe(404);

    const badApp = await adminRequest("POST", "/api/admin/source-map-tokens", {
      name: "bad",
      projectId,
      appId: crypto.randomUUID(),
    });
    expect(badApp.status).toBe(404);
  });

  it("rotates and revokes upload tokens", async () => {
    const listRes = await adminRequest(
      "GET",
      `/api/admin/source-map-tokens?projectId=${projectId}`,
    );
    const listBody = (await listRes.json()) as any;
    const tokenId = listBody.data[0]!.id;

    const rotated = await adminRequest(
      "POST",
      `/api/admin/source-map-tokens/${tokenId}/rotate`,
    );
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as any;
    expect(rotatedBody.token).toMatch(/^smt_/);

    const revoked = await adminRequest(
      "DELETE",
      `/api/admin/source-map-tokens/${tokenId}`,
    );
    expect(revoked.status).toBe(200);
  });

  it("uploads a source map artifact and lists it", async () => {
    const mapJson = JSON.stringify({
      version: 3,
      sources: ["app.ts"],
      mappings: "AAAA",
    });

    const uploadRes = await fetch(
      `http://${publicKey}@test.local/1/api/0/projects/${projectSlug}/releases/1.0.0/files/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `sentry_token=${uploadToken}`,
        },
        body: JSON.stringify({
          version: 1,
          dist: null,
          filename: "app.js.map",
          file: "app.js.map",
          sourcemap: mapJson,
        }),
      },
    );
    expect(uploadRes.ok).toBe(true);

    const listRes = await adminRequest(
      "GET",
      `/api/admin/source-maps?projectId=${projectId}&appId=${appId}&release=1.0.0`,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.data.length).toBeGreaterThan(0);
    const artifact = listBody.data[0];
    expect(artifact.projectId).toBe(projectId);
    expect(artifact.appId).toBe(appId);
    expect(artifact.release).toBe("1.0.0");
    expect(artifact.filename).toBe("app.js.map");
  });

  it("resolves a source map position", async () => {
    const resolveRes = await adminRequest(
      "POST",
      "/api/admin/source-maps/resolve",
      {
        projectId,
        release: "1.0.0",
        filename: "app.js.map",
        line: 1,
        column: 1,
      },
    );
    expect(resolveRes.status).toBe(200);
    const resolveBody = (await resolveRes.json()) as any;
    expect(resolveBody.filename).toBe("app.js.map");
    expect(resolveBody.release).toBe("1.0.0");
  });

  it("filters source maps by project, app and release", async () => {
    const listRes = await adminRequest(
      "GET",
      `/api/admin/source-maps?projectId=${projectId}&appId=${appId}&release=1.0.0`,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.data.length).toBeGreaterThan(0);
    for (const artifact of listBody.data) {
      expect(artifact.projectId).toBe(projectId);
      expect(artifact.appId).toBe(appId);
      expect(artifact.release).toBe("1.0.0");
    }
  });

  it("deletes a source map artifact", async () => {
    const listRes = await adminRequest(
      "GET",
      `/api/admin/source-maps?projectId=${projectId}&appId=${appId}&release=1.0.0`,
    );
    const listBody = (await listRes.json()) as any;
    const artifactId = listBody.data[0]!.id;

    const deleted = await adminRequest(
      "DELETE",
      `/api/admin/source-maps/${artifactId}`,
    );
    expect(deleted.status).toBe(200);

    const gone = await adminRequest(
      "GET",
      `/api/admin/source-maps?projectId=${projectId}&appId=${appId}&release=1.0.0`,
    );
    const goneBody = (await gone.json()) as any;
    expect(goneBody.data.some((a: { id: string }) => a.id === artifactId)).toBe(
      false,
    );
  });
});
