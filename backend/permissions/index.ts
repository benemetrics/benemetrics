import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { permissionGrantDAO } from "db/dao/permission-grants";
import { permissionAuditDAO } from "db/dao/permission-audit";
import { permissionRuleDAO } from "db/dao/permission-rules";
import { badRequest } from "backend/errors";
import { resolveAdminId, getAdminToken, rotateAdminToken } from "../auth";
import { requireAdmin } from "./engine";
import {
  normalizeScopeList,
  permissionGrantBodySchema,
  permissionGrantPatchSchema,
  permissionRuleBodySchema,
  permissionRulePatchSchema,
} from "../protocol/permissions";

// The audit write never fails the mutation: the change is already
// committed when it is recorded.
async function audit(
  actorId: string,
  target: "rule" | "grant",
  targetId: string,
  action: "create" | "update" | "delete",
  before: unknown,
  after: unknown,
): Promise<void> {
  try {
    await permissionAuditDAO.record({ actorId, target, targetId, action, before, after });
  } catch (error) {
    console.error("[Permissions] Failed to record the audit entry:", error);
  }
}

function normalizeName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) throw badRequest('"name" must not be empty');
  return trimmed;
}

// ── oidc surface: the caller's identity and read scope ──
export const sessionRoutes = new Elysia({ prefix: "/api/admin/session" })
  .resolve(resolveAdminId)
  .get(
    "/",
    async ({ adminId, isAdmin, adminScope }) => ({
      id: adminId,
      isAdmin,
      scope: adminScope,
    }),
  );

// ── oidc surface: the permission administration (admin token only) ──
export const permissionRoutes = new Elysia({ prefix: "/api/admin/permissions" })
  .resolve(resolveAdminId)
  .get(
    "/rules",
    async ({ query, isAdmin }) => {
      requireAdmin({ isAdmin });
      return permissionRuleDAO.list({ cursor: query.cursor, limit: query.limit });
    },
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/grants",
    async ({ query, isAdmin }) => {
      requireAdmin({ isAdmin });
      return permissionGrantDAO.list({ cursor: query.cursor, limit: query.limit });
    },
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .post(
    "/rules",
    async ({ body, isAdmin, adminId }) => {
      requireAdmin({ isAdmin });
      const created = await permissionRuleDAO.create({
        ...body, // isEnabled passes through
        name: normalizeName(body.name),
        environments: normalizeScopeList(body.environments, "environments"),
        appPrefixes: normalizeScopeList(body.appPrefixes, "appPrefixes"),
      });
      await audit(adminId, "rule", created.id, "create", null, created);
      return created;
    },
    { body: permissionRuleBodySchema },
  )
  .patch(
    "/rules/:id",
    async ({ params: { id }, body, isAdmin, adminId }) => {
      requireAdmin({ isAdmin });
      const current = await permissionRuleDAO.findByIdOrThrow(id);
      if (body.name !== undefined && normalizeName(body.name) !== current.name) {
        const clash = await permissionRuleDAO.findByName(body.name);
        if (clash) throw badRequest(`Permission rule already exists: ${body.name}`);
      }
      const { name, environments, appPrefixes, ...passthrough } = body;
      const updated = await permissionRuleDAO.updateOrThrow(id, {
        ...passthrough, // isEnabled passes through
        ...(name !== undefined ? { name: normalizeName(name) } : {}),
        ...(environments !== undefined
          ? { environments: normalizeScopeList(environments, "environments") }
          : {}),
        ...(appPrefixes !== undefined
          ? { appPrefixes: normalizeScopeList(appPrefixes, "appPrefixes") }
          : {}),
      });
      await audit(adminId, "rule", id, "update", current, updated);
      return updated;
    },
    { params: arktype({ id: "string.uuid" }), body: permissionRulePatchSchema },
  )
  .delete(
    "/rules/:id",
    async ({ params: { id }, isAdmin, adminId }) => {
      requireAdmin({ isAdmin });
      const current = await permissionRuleDAO.findByIdOrThrow(id);
      await permissionRuleDAO.delete(id);
      await audit(adminId, "rule", id, "delete", current, null);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/grants",
    async ({ body, isAdmin, adminId }) => {
      requireAdmin({ isAdmin });
      const created = await permissionGrantDAO.create({
        ...body, // isEnabled/canWrite pass through
        identityId: body.identityId.trim(),
        label: body.label?.trim() ?? null,
        environments: normalizeScopeList(body.environments, "environments"),
        appPrefixes: normalizeScopeList(body.appPrefixes, "appPrefixes"),
      });
      await audit(adminId, "grant", created.id, "create", null, created);
      return created;
    },
    { body: permissionGrantBodySchema },
  )
  .patch(
    "/grants/:id",
    async ({ params: { id }, body, isAdmin, adminId }) => {
      requireAdmin({ isAdmin });
      const current = await permissionGrantDAO.findByIdOrThrow(id);
      if (body.identityId !== undefined && body.identityId.trim() !== current.identityId) {
        const clash = await permissionGrantDAO.findByIdentityId(body.identityId.trim());
        if (clash) throw badRequest(`Permission grant already exists: ${body.identityId}`);
      }
      const { identityId, label, environments, appPrefixes, ...passthrough } = body;
      const updated = await permissionGrantDAO.updateOrThrow(id, {
        ...passthrough, // isEnabled/canWrite pass through
        ...(identityId !== undefined ? { identityId: identityId.trim() } : {}),
        ...(label !== undefined ? { label: label?.trim() ?? null } : {}),
        ...(environments !== undefined
          ? { environments: normalizeScopeList(environments, "environments") }
          : {}),
        ...(appPrefixes !== undefined
          ? { appPrefixes: normalizeScopeList(appPrefixes, "appPrefixes") }
          : {}),
      });
      await audit(adminId, "grant", id, "update", current, updated);
      return updated;
    },
    { params: arktype({ id: "string.uuid" }), body: permissionGrantPatchSchema },
  )
  .delete(
    "/grants/:id",
    async ({ params: { id }, isAdmin, adminId }) => {
      requireAdmin({ isAdmin });
      const current = await permissionGrantDAO.findByIdOrThrow(id);
      await permissionGrantDAO.delete(id);
      await audit(adminId, "grant", id, "delete", current, null);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .get(
    "/audit",
    async ({ query, isAdmin }) => {
      requireAdmin({ isAdmin });
      return permissionAuditDAO.list({
        cursor: query.cursor,
        limit: query.limit,
        ...(query.target ? { target: query.target } : {}),
      });
    },
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
        target: "'rule' | 'grant'?",
      }),
    },
  );
