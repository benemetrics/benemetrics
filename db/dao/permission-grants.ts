import { db } from "db";
import { permissionGrants, permissionRules, permissionsProjectApp } from "db/schema/permissions";
import { desc, eq } from "drizzle-orm";
import { conflict, internalError, notFound } from "backend/errors";
import { cursorAfter, cursorLimit } from "./cursor";
import type { string } from "node_modules/arktype/out/keywords/string";

const grantFields = {
  id: permissionGrants.id,
  identityId: permissionGrants.identityId,
  label: permissionGrants.label,
  projectFixes: permissionGrants.projectIds,
  appFixes: permissionGrants.appPrefixes,
  isEnabled: permissionGrants.isEnabled,
  canWrite: permissionGrants.canWrite,
  createdAt: permissionGrants.createdAt,
  updatedAt: permissionGrants.updatedAt,
};

export const permissionGrantDAO = {
  create: async (input: PermissionGrantInput) => {
    const [row] = await db
      .insert(permissionGrants)
      .values({
        identityId: input.identityId,
        label: input.label ?? null,
        projectPrefixes: JSON.stringify(input.projectIds),
        appPrefixes: JSON.stringify(input.appPrefixes),
        isEnabled: input.isEnabled === false ? 0 : 1,
        canWrite: input.canWrite === true ? 1 : 0,
      })
      .onConflictDoNothing({ target: permissionGrants.identityId })
      .returning(grantFields);

    if (!row) throw conflict(`Permission grant already exists: ${input.identityId}`);
    return row;
  },

  findById: async (id: string) => {
    const [row] = await db
      .select(grantFields)
      .from(permissionGrants)
      .where(eq(permissionGrants.id, id))
      .limit(1);
    return row;
  },

  findByIdOrThrow: async (id: string) => {
    const grant = await permissionGrantDAO.findById(id);
    if (!grant) throw notFound("Permission grant", id);
    return grant;
  },

  list: async (options?: { cursor?: string; limit?: number }) => {
    const limit = cursorLimit(options?.limit);
    const { condition, empty } = await cursorAfter(
      permissionGrants,
      permissionGrants.id,
      permissionGrants.createdAt,
      options?.cursor,
    );
    if (empty) return { data: [] };

    return db
      .select(grantFields)
      .from(permissionGrants)
      .where(condition)
      .orderBy(desc(permissionGrants.createdAt), desc(permissionGrants.id))
      .limit(limit);
  },

  updateOrThrow: async (
    id: string,
    data: Partial<PermissionGrantInput>,
  ) => {
    const [row] = await db
      .update(permissionGrants)
      .set({
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(permissionGrants.id, id))
      .returning(grantFields);
    if (!row) {
      throw notFound("Permission grant", id);
    }
    return row;
  },

  getUserGrantWithPermissions: async (identityId: string) => {
    const x = await db
      .select({ projectId: permissionsProjectApp.projectId, appId: permissionsProjectApp.appId })
      .from(permissionGrants)
      .where(eq(permissionGrants.identityId, identityId))
      .rightJoin(permissionsProjectApp, eq(permissionsProjectApp.permissionGrant, permissionGrants.id))

    return { projectIds: x.map(({ projectId }) => projectId), appsIds: x.map(({ appId }) => appId) }
  },

  getAllowedGroups: async () => {
    const groups = await db.select({ group: permissionRules.group }).from(permissionRules);
    return new Set(groups.map(({ group }) => group));
  },

  delete: async (id: string) => db
    .delete(permissionGrants)
    .where(eq(permissionGrants.id, id))
    .returning({ id: permissionGrants.id }),

  // The identities the system knows about (every identity that has a grant).
  // Feeds the user dropdown on the grant form so no one pastes a raw id.
  listIdentities: async (): Promise<Array<{ id: string; label: string | null }>> => {
    const rows = await db
      .select({
        id: permissionGrants.identityId,
        label: permissionGrants.label,
      })
      .from(permissionGrants)
      .groupBy(permissionGrants.identityId, permissionGrants.label)
      .orderBy(permissionGrants.identityId);
    return rows;
  },
};
