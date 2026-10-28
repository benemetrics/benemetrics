/**
 * API Test: the permission scope engine + the permission routes.
 *
 * The scope of an identity: the enabled grant for its id wins
 * exclusively, otherwise the union of the enabled group rules it matches.
 * The view expands the scope into the visible apps and projects.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { handleFetch as fetch, TEST_ORIGIN, ADMIN_TOKEN } from "./test-helpers";
import { permissionGrantDAO } from "db/dao/permission-grants";
import { permissionRuleDAO } from "db/dao/permission-rules";
import { computeScopedView, resolveScopeForIdentity } from "backend/permissions/engine";
import { projectDAO, appDAO } from "db/dao/project";

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

let projectId = "";
let otherProjectId = "";

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

describe("Permission scope engine", () => {
  beforeAll(async () => {
    projectId = (await projectDAO.create({ name: `Perm-${uniq()}`, slug: `perm-${uniq()}` })).id;
    otherProjectId = (await projectDAO.create({ name: `Perm2-${uniq()}`, slug: `perm2-${uniq()}` })).id;
  });

  it("resolves the union of the matching group rules", async () => {
    await permissionRuleDAO.create({
      name: "Team A",
      projectIds: [],
      appPrefixes: ["checkout-"],
    });
    await permissionRuleDAO.create({
      name: "Team B",
      projectIds: [],
      appPrefixes: ["billing-"],
    });

    const scope = await resolveScopeForIdentity({
      id: "group-user",
      groups: ["team a", "TEAM B"],
    });
    expect(scope).not.toBeNull();
    expect(scope!.appPrefixes).toEqual(["checkout-", "billing-"]);
  });

  it("ignores the groups that match no rule", async () => {
    const scope = await resolveScopeForIdentity({ id: "nobody", groups: ["team a"] });
    expect(scope).not.toBeNull();
    expect(scope!.appPrefixes).toEqual(["checkout-"]);
  });

  it("has no grant without a rule and without a grant", async () => {
    const scope = await resolveScopeForIdentity({ id: "nobody", groups: ["unknown"] });
    expect(scope).toBeNull();
  });

  it("lets an enabled grant win exclusively over the group rules", async () => {
    await permissionGrantDAO.create({
      identityId: "granted-user",
      projectIds: [],
      appPrefixes: ["billing-"],
    });
    const scope = await resolveScopeForIdentity({
      id: "granted-user",
      groups: ["team a"],
    });
    expect(scope).not.toBeNull();
    expect(scope!.appPrefixes).toEqual(["billing-"]);
  });

  it("falls through to the group rules when the grant is disabled", async () => {
    const grant = await permissionGrantDAO.create({
      identityId: "disabled-user",
      projectIds: [],
      appPrefixes: ["billing-"],
      isEnabled: false,
    });
    const scope = await resolveScopeForIdentity({
      id: "disabled-user",
      groups: ["team a"],
    });
    expect(scope!.appPrefixes).toEqual(["checkout-"]);
    await permissionGrantDAO.delete(grant.id);
  });

  it("treats an enabled grant with an empty scope as read-nothing", async () => {
    await permissionGrantDAO.create({
      identityId: "read-nothing",
      projectIds: [],
      appPrefixes: [],
    });
    const scope = await resolveScopeForIdentity({ id: "read-nothing", groups: [] });
    expect(scope).not.toBeNull();
    expect(scope!.appPrefixes).toEqual([]);
    const view = await computeScopedView(scope!);
    expect(view.appIds.size).toBe(0);
    expect(view.projectIds.size).toBe(0);
  });

  it("returns an empty view when nothing matches the scope", async () => {
    const view = await computeScopedView({
      appPrefixes: ["nope-"],
      projectIds: [otherProjectId],
    });
    expect(view.appIds.size).toBe(0);
    expect(view.projectIds.size).toBe(0);
  });

  it("propagates projectIds through an enabled grant's scope", async () => {
    await permissionGrantDAO.create({
      identityId: "project-user",
      projectIds: [otherProjectId],
      appPrefixes: [],
    });
    const scope = await resolveScopeForIdentity({
      id: "project-user",
      groups: [],
    });
    expect(scope).not.toBeNull();
    expect(scope!.projectIds).toEqual([otherProjectId]);
    expect(scope!.appPrefixes).toEqual([]);
  });
});

describe("Permission routes", () => {
  it("creates, lists, patches and deletes a group rule", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      appPrefixes: ["api-"],
    });
    expect(created.status).toBe(200);
    const rule = (await created.json()) as { id: string; name: string };
    expect(rule.id).toBeDefined();

    const list = await apiRequest("GET", "/api/admin/permissions/rules");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((entry) => entry.id === rule.id)).toBe(true);

    const patched = await apiRequest("PATCH", `/api/admin/permissions/rules/${rule.id}`, {
      appPrefixes: ["staging-"],
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { appPrefixes: string[] }).appPrefixes).toEqual([
      "staging-",
    ]);

    const deleted = await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);
    expect(deleted.status).toBe(200);
  });

  it("creates and deletes an identity grant", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/grants", {
      identityId: `user-${uniq()}`,
      label: "A user",
      appPrefixes: [],
    });
    expect(created.status).toBe(200);
    const grant = (await created.json()) as { id: string };

    const list = await apiRequest("GET", "/api/admin/permissions/grants");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((entry) => entry.id === grant.id)).toBe(true);

    const deleted = await apiRequest("DELETE", `/api/admin/permissions/grants/${grant.id}`);
    expect(deleted.status).toBe(200);
  });

  it("normalizes the scope lists", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      appPrefixes: ["  api-  ", "api-", ""],
    });
    expect(created.status).toBe(200);
    const rule = (await created.json()) as {
      id: string;
      appPrefixes: string[];
    };
    expect(rule.appPrefixes).toEqual(["api-"]);
    expect(rule.appPrefixes).toEqual(["api-"]);
    await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);
  });

  it("rejects a duplicate rule name and an oversized scope list", async () => {
    const name = `Team ${uniq()}`;
    const first = await apiRequest("POST", "/api/admin/permissions/rules", {
      name,
      appPrefixes: [],
    });
    expect(first.status).toBe(200);
    const rule = (await first.json()) as { id: string };

    const duplicate = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: name.toUpperCase(),
      appPrefixes: [],
    });
    expect(duplicate.status).toBe(409);

    const tooMany = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      appPrefixes: Array.from({ length: 101 }, (_, index) => `prefix-${index}`),
    });
    expect(tooMany.status).toBe(400);

    await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);
  });

  it("records every change in the audit trail", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      appPrefixes: ["production-"],
    });
    const rule = (await created.json()) as { id: string };

    const patched = await apiRequest("PATCH", `/api/admin/permissions/rules/${rule.id}`, {
      appPrefixes: ["staging-"],
    });
    expect(patched.status).toBe(200);
    await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);

    const audit = await apiRequest("GET", "/api/admin/permissions/audit?target=rule");
    expect(audit.status).toBe(200);
    const body = (await audit.json()) as {
      data: Array<{
        actorId: string;
        action: string;
        target: string;
        targetId: string;
        before: unknown;
        after: unknown;
      }>;
    };
    const entries = body.data.filter((entry) => entry.targetId === rule.id);
    expect(entries.map((entry) => entry.action)).toEqual(["delete", "update", "create"]);
    expect(entries.every((entry) => entry.actorId === "local-admin")).toBe(true);
    expect(entries.every((entry) => entry.target === "rule")).toBe(true);
    const created_entry = entries[entries.length - 1]!;
    expect(created_entry.before).toBeNull();
    expect((created_entry.after as { appPrefixes: string[] }).appPrefixes).toEqual([
      "production-",
    ]);
  });

  it("records the write access on a grant", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/grants", {
      identityId: `user-${uniq()}`,
      appPrefixes: [],
      canWrite: true,
    });
    expect(created.status).toBe(200);
    const grant = (await created.json()) as { id: string; canWrite: boolean };
    expect(grant.canWrite).toBe(true);

    const patched = await apiRequest(
      "PATCH",
      `/api/admin/permissions/grants/${grant.id}`,
      { canWrite: false },
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { canWrite: boolean }).canWrite).toBe(false);
  });

  it("rejects an unknown rule", async () => {
    const response = await apiRequest("PATCH", `/api/admin/permissions/rules/${crypto.randomUUID()}`, {
      isEnabled: false,
    });
    expect(response.status).toBe(404);
  });

  it("round-trips the project scope on a rule", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      projectIds: [projectId],
      appPrefixes: ["api-"],
    });
    expect(created.status).toBe(200);
    const rule = (await created.json()) as {
      id: string;
      projectIds: string[];
      appPrefixes: string[];
    };
    expect(rule.projectIds).toEqual([projectId]);
    expect(rule.appPrefixes).toEqual(["api-"]);

    const list = await apiRequest("GET", "/api/admin/permissions/rules");
    const body = (await list.json()) as { data: Array<{ projectIds: string[] }> };
    expect(body.data.some((entry) => entry.projectIds.includes(projectId))).toBe(true);

    await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);
  });

  it("round-trips the project scope on a grant", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/grants", {
      identityId: `user-${uniq()}`,
      projectIds: [otherProjectId],
      appPrefixes: [],
    });
    expect(created.status).toBe(200);
    const grant = (await created.json()) as { id: string; projectIds: string[] };
    expect(grant.projectIds).toEqual([otherProjectId]);

    const list = await apiRequest("GET", "/api/admin/permissions/grants");
    const body = (await list.json()) as { data: Array<{ projectIds: string[] }> };
    expect(body.data.some((entry) => entry.projectIds.includes(otherProjectId))).toBe(true);

    await apiRequest("DELETE", `/api/admin/permissions/grants/${grant.id}`);
  });

  it("lists the known identities for the user picker", async () => {
    await permissionGrantDAO.create({
      identityId: `known-user-${uniq()}`,
      label: "A known user",
      projectIds: [],
      appPrefixes: [],
    });

    const identities = await apiRequest("GET", "/api/admin/permissions/identities");
    expect(identities.status).toBe(200);
    const body = (await identities.json()) as {
      data: Array<{ id: string; label: string | null }>;
    };
    expect(body.data.some((entry) => entry.id.startsWith("known-user-"))).toBe(true);
    expect(body.data.some((entry) => entry.label === "A known user")).toBe(true);
  });
});
