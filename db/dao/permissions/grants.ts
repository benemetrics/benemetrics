import { db } from "db";
import {
  permissionGrantPublicFields,
  permissionGrants,
  permissionRules,
  permissionsProjectApp,
} from "db/schema/permissions";
import { desc, eq, lt } from "drizzle-orm";
import { conflict, internalError, notFound } from "backend/errors";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";
import type { string } from "node_modules/arktype/out/keywords/string";

export const permissionGrantDAO = {
  create: async (input: PermissionGrantInput) => {
    const [row] = await db
      .insert(permissionGrants)
      .values({
        identityId: input.identityId,
        label: input.label ?? null,
        projectFixes: JSON.stringify(input.projectIds),
        appFixes: JSON.stringify(input.appPrefixes),
      })
      .onConflictDoNothing({ target: permissionGrants.identityId })
      .returning(permissionGrantPublicFields);

    if (!row)
      throw conflict(`Permission grant already exists: ${input.identityId}`);
    return row;
  },

  findById: (id: string) =>
    db
      .select(permissionGrantPublicFields)
      .from(permissionGrants)
      .where(eq(permissionGrants.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const grant = await permissionGrantDAO.findById(id);
    if (!grant) throw notFound("Permission grant", id);
    return grant;
  },

  // Returns the grant for an identity, or undefined when none exists.
  findByIdentityId: async (identityId: string) => {
    const [row] = await db
      .select(permissionGrantPublicFields)
      .from(permissionGrants)
      .where(eq(permissionGrants.identityId, identityId))
      .limit(1);
    return row ?? undefined;
  },

  list: (options?: { cursor?: string; limit?: number }) => {
    const limit = cursorLimit(options?.limit);
    const where = whereNotNull(lt, permissionGrants.id, options?.cursor);

    return db
      .select(permissionGrantPublicFields)
      .from(permissionGrants)
      .where(where)
      .orderBy(desc(permissionGrants.id))
      .limit(limit);
  },

  updateOrThrow: async (id: string, data: Partial<PermissionGrantInput>) => {
    const [row] = await db
      .update(permissionGrants)
      .set({
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(permissionGrants.id, id))
      .returning(permissionGrantPublicFields);
    if (!row) {
      throw notFound("Permission grant", id);
    }
    return row;
  },

  getUserGrantWithPermissions: async (identityId: string) => {
    const x = await db
      .select({
        projectId: permissionsProjectApp.projectId,
        appId: permissionsProjectApp.appId,
      })
      .from(permissionGrants)
      .where(eq(permissionGrants.identityId, identityId))
      .rightJoin(
        permissionsProjectApp,
        eq(permissionsProjectApp.permissionGrant, permissionGrants.id),
      );

    return {
      projectIds: x.map(({ projectId }) => projectId),
      appsIds: x.map(({ appId }) => appId),
    };
  },

  getAllowedGroups: async () => {
    const groups = await db
      .select({ group: permissionRules.group })
      .from(permissionRules);
    return new Set(groups.map(({ group }) => group));
  },

  delete: (id: string) =>
    db
      .delete(permissionGrants)
      .where(eq(permissionGrants.id, id))
      .returning({ id: permissionGrants.id }),
};
