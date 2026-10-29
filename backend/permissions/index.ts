import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { permissionGrantDAO } from "db/dao/permissions/grants";
import { permissionRuleDAO } from "db/dao/permissions/rules";
import { badRequest } from "backend/errors";
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
  // No-op: permission_audit table is not provisioned in the schema.
  return;
}

function normalizeName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) throw badRequest('"name" must not be empty');
  return trimmed;
}

// ── oidc surface: the permission administration (admin token only) ──
export const permissionRoutes = new Elysia({ prefix: "/api/admin/permissions" })
  .get(
    "/rules",
    async ({ query }) => {
      return permissionRuleDAO.list({
        cursor: query.cursor,
        limit: query.limit,
      });
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
    async ({ query }) => {
      return permissionGrantDAO.list({
        cursor: query.cursor,
        limit: query.limit,
      });
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
    async ({ body }) => {
      const created = await permissionRuleDAO.create({
        ...body, // isEnabled passes through
        name: normalizeName(body.name),
        projectIds: normalizeScopeList(body.projectIds ?? [], "projectIds"),
        appPrefixes: normalizeScopeList(body.appPrefixes ?? [], "appPrefixes"),
      });
      await audit("system", "rule", created.id, "create", null, created);
      return created;
    },
    { body: permissionRuleBodySchema },
  )
  .patch(
    "/rules/:id",
    async ({ params: { id }, body }) => {
      const current = await permissionRuleDAO.findByIdOrThrow(id);
      if (
        body.name !== undefined &&
        normalizeName(body.name) !== current.name
      ) {
        const clash = await permissionRuleDAO.findByName(body.name);
        if (clash)
          throw badRequest(`Permission rule already exists: ${body.name}`);
      }
      const { name, projectIds, appPrefixes, ...passthrough } = body;
      const updated = await permissionRuleDAO.updateOrThrow(id, {
        ...passthrough, // isEnabled passes through
        ...(name !== undefined ? { name: normalizeName(name) } : {}),
        ...(projectIds !== undefined
          ? { projectIds: normalizeScopeList(projectIds, "projectIds") }
          : {}),
        ...(appPrefixes !== undefined
          ? { appPrefixes: normalizeScopeList(appPrefixes, "appPrefixes") }
          : {}),
      });
      await audit("system", "rule", id, "update", current, updated);
      return updated;
    },
    { params: arktype({ id: "string.uuid" }), body: permissionRulePatchSchema },
  )
  .delete(
    "/rules/:id",
    async ({ params: { id } }) => {
      const current = await permissionRuleDAO.findByIdOrThrow(id);
      await permissionRuleDAO.delete(id);
      await audit("system", "rule", id, "delete", current, null);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/grants",
    async ({ body }) => {
      const created = await permissionGrantDAO.create({
        ...body, // isEnabled/canWrite pass through
        identityId: body.identityId.trim(),
        label: body.label?.trim() ?? null,
        projectIds: normalizeScopeList(body.projectIds ?? [], "projectIds"),
        appPrefixes: normalizeScopeList(body.appPrefixes ?? [], "appPrefixes"),
      });
      await audit("system", "grant", created.id, "create", null, created);
      return created;
    },
    { body: permissionGrantBodySchema },
  )
  .patch(
    "/grants/:id",
    async ({ params: { id }, body }) => {
      const current = await permissionGrantDAO.findByIdOrThrow(id);
      if (
        body.identityId !== undefined &&
        body.identityId.trim() !== current.identityId
      ) {
        const clash = await permissionGrantDAO.findByIdentityId(
          body.identityId.trim(),
        );
        if (clash)
          throw badRequest(
            `Permission grant already exists: ${body.identityId}`,
          );
      }
      const { identityId, label, projectIds, appPrefixes, ...passthrough } =
        body;
      const updated = await permissionGrantDAO.updateOrThrow(id, {
        ...passthrough, // isEnabled/canWrite pass through
        ...(identityId !== undefined ? { identityId: identityId.trim() } : {}),
        ...(label !== undefined ? { label: label?.trim() ?? null } : {}),
        ...(projectIds !== undefined
          ? { projectIds: normalizeScopeList(projectIds, "projectIds") }
          : {}),
        ...(appPrefixes !== undefined
          ? { appPrefixes: normalizeScopeList(appPrefixes, "appPrefixes") }
          : {}),
      });
      await audit("system", "grant", id, "update", current, updated);
      return updated;
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: permissionGrantPatchSchema,
    },
  )
  .delete(
    "/grants/:id",
    async ({ params: { id } }) => {
      const current = await permissionGrantDAO.findByIdOrThrow(id);
      await permissionGrantDAO.delete(id);
      await audit("system", "grant", id, "delete", current, null);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .get("/audit", async () => {
    return { data: [] };
  })
  .get("/identities", async () => {
    return { data: [] };
  });
