/**
 * API Test: the permission scope engine + the permission routes.
 *
 * The scope of an identity: the enabled grant for its id wins
 * exclusively, otherwise the union of the enabled group rules it matches.
 * The view expands the scope into the visible apps, environments and
 * projects.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { handleFetch as fetch, TEST_ORIGIN } from "./test-helpers";
import { permissionGrantDAO } from "db/dao/permission-grants";
import { permissionRuleDAO } from "db/dao/permission-rules";
import { computeScopedView, resolveScopeForIdentity } from "backend/permissions/engine";
import { projectDAO, appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";

const ADMIN_TOKEN = "API-Key e2e-admin-token";
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

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
  let environmentId = "";
  let environmentName = "";
  let otherEnvironmentName = "";
  let projectId = "";
  let appId = "";
  let otherAppId = "";

  beforeAll(async () => {
    projectId = (await projectDAO.create({ name: `Perm-${uniq()}`, slug: `perm-${uniq()}` })).id;
    const environment = await environmentDAO.create({
      projectId,
      name: "Production",
      slug: `prod-${uniq()}`,
      isDefault: 1,
    });
    environmentId = environment.id;
    environmentName = environment.name;
    const other = await environmentDAO.create({
      projectId,
      name: "Staging",
      slug: `stg-${uniq()}`,
      isDefault: 0,
    });
    otherEnvironmentName = other.name;
    appId = (await appDAO.create({
      id: crypto.randomUUID(),
      projectId,
      environmentId: environment.id,
      name: "checkout-api",
      platform: "javascript",
      ingestKey: `ing-${uniq()}`,
      publicKey: `pub-${uniq()}`,
    })).id;
    otherAppId = (await appDAO.create({
      id: crypto.randomUUID(),
      projectId,
      environmentId: other.id,
      name: "billing-worker",
      platform: "javascript",
      ingestKey: `ing-${uniq()}`,
      publicKey: `pub-${uniq()}`,
    })).id;
  });

  it("resolves the union of the matching group rules", async () => {
    await permissionRuleDAO.create({
      name: "Team A",
      environments: [environmentName],
      appPrefixes: [],
    });
    await permissionRuleDAO.create({
      name: "Team B",
      environments: [],
      appPrefixes: ["billing-"],
    });

    const scope = await resolveScopeForIdentity({
      id: "group-user",
      groups: ["team a", "TEAM B"],
    });
    expect(scope).not.toBeNull();
    expect(scope!.environments).toEqual([environmentName]);
    expect(scope!.appPrefixes).toEqual(["billing-"]);
  });

  it("ignores the groups that match no rule", async () => {
    const scope = await resolveScopeForIdentity({ id: "nobody", groups: ["team a"] });
    expect(scope).not.toBeNull();
    expect(scope!.environments).toEqual([environmentName]);
  });

  it("has no grant without a rule and without a grant", async () => {
    const scope = await resolveScopeForIdentity({ id: "nobody", groups: ["unknown"] });
    expect(scope).toBeNull();
  });

  it("lets an enabled grant win exclusively over the group rules", async () => {
    await permissionGrantDAO.create({
      identityId: "granted-user",
      environments: [otherEnvironmentName],
      appPrefixes: [],
    });
    const scope = await resolveScopeForIdentity({
      id: "granted-user",
      groups: ["team a"],
    });
    expect(scope).not.toBeNull();
    expect(scope!.environments).toEqual([otherEnvironmentName]);
    expect(scope!.appPrefixes).toEqual([]);
  });

  it("falls through to the group rules when the grant is disabled", async () => {
    const grant = await permissionGrantDAO.create({
      identityId: "disabled-user",
      environments: [otherEnvironmentName],
      appPrefixes: [],
      isEnabled: false,
    });
    const scope = await resolveScopeForIdentity({
      id: "disabled-user",
      groups: ["team a"],
    });
    expect(scope!.environments).toEqual([environmentName]);
    await permissionGrantDAO.delete(grant.id);
  });

  it("treats an enabled grant with an empty scope as read-nothing", async () => {
    await permissionGrantDAO.create({
      identityId: "read-nothing",
      environments: [],
      appPrefixes: [],
    });
    const scope = await resolveScopeForIdentity({ id: "read-nothing", groups: [] });
    expect(scope).not.toBeNull();
    expect(scope!.environments).toEqual([]);
    const view = await computeScopedView(scope!);
    expect(view.appIds.size).toBe(0);
    expect(view.environmentIds.size).toBe(0);
    expect(view.projectIds.size).toBe(0);
  });

  it("expands an environment grant to all of its apps and their project", async () => {
    const view = await computeScopedView({
      environments: [environmentName],
      appPrefixes: [],
    });
    expect(view.appIds.has(appId)).toBe(true);
    expect(view.appIds.has(otherAppId)).toBe(false);
    expect(view.environmentIds.has(environmentId)).toBe(true);
    expect(view.projectIds.has(projectId)).toBe(true);
  });

  it("expands an app prefix grant to the matching apps", async () => {
    const view = await computeScopedView({
      environments: [],
      appPrefixes: ["billing-"],
    });
    expect(view.appIds.has(otherAppId)).toBe(true);
    expect(view.appIds.has(appId)).toBe(false);
    // The environment holding the visible app is visible too.
    expect(view.environmentIds.size).toBe(1);
  });
});

describe("Permission routes", () => {
  it("creates, lists, patches and deletes a group rule", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      environments: ["production"],
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
      environments: ["staging"],
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { environments: string[] }).environments).toEqual([
      "staging",
    ]);

    const deleted = await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);
    expect(deleted.status).toBe(200);
  });

  it("creates and deletes an identity grant", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/grants", {
      identityId: `user-${uniq()}`,
      label: "A user",
      environments: ["production"],
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
      environments: ["  Production  ", "production", ""],
      appPrefixes: [" api- "],
    });
    expect(created.status).toBe(200);
    const rule = (await created.json()) as {
      id: string;
      environments: string[];
      appPrefixes: string[];
    };
    expect(rule.environments).toEqual(["Production"]);
    expect(rule.appPrefixes).toEqual(["api-"]);
    await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);
  });

  it("rejects a duplicate rule name and an oversized scope list", async () => {
    const name = `Team ${uniq()}`;
    const first = await apiRequest("POST", "/api/admin/permissions/rules", {
      name,
      environments: [],
      appPrefixes: [],
    });
    expect(first.status).toBe(200);
    const rule = (await first.json()) as { id: string };

    const duplicate = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: name.toUpperCase(),
      environments: [],
      appPrefixes: [],
    });
    expect(duplicate.status).toBe(409);

    const tooMany = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      environments: Array.from({ length: 101 }, (_, index) => `env-${index}`),
      appPrefixes: [],
    });
    expect(tooMany.status).toBe(400);

    await apiRequest("DELETE", `/api/admin/permissions/rules/${rule.id}`);
  });

  it("records every change in the audit trail", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/rules", {
      name: `Team ${uniq()}`,
      environments: ["production"],
      appPrefixes: [],
    });
    const rule = (await created.json()) as { id: string };

    const patched = await apiRequest("PATCH", `/api/admin/permissions/rules/${rule.id}`, {
      environments: ["staging"],
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
    expect((created_entry.after as { environments: string[] }).environments).toEqual([
      "production",
    ]);
  });

  it("records the write access on a grant", async () => {
    const created = await apiRequest("POST", "/api/admin/permissions/grants", {
      identityId: `user-${uniq()}`,
      environments: ["production"],
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
});
