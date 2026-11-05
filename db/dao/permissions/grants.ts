import { apps, apps, db } from "db";
import {
  permissionGrantPublicFields,
  permissionGrants,
  permissionRules,
  permissionsRulesProjects,
  permissionsGrantsProjects,
  type PermissionGrantInsert,
} from "db/schema/permissions";
import { desc, eq, inArray, lt } from "drizzle-orm";
import { notFound } from "backend/errors";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";

export const permissionGrantDAO = {
  create: async (input: PermissionGrantInsert) => db
      .insert(permissionGrants)
      .values(input)
      .returning(permissionGrantPublicFields).then(([row]) => row),

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

  updateOrThrow: async (id: string, data: Partial<PermissionGrantInsert>) => {
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

  getUserGrantWithPermissions: async (identityId: string, userGroups: string[]) => {
    const [grants, groups] = await Promise.all([
      db
        .select({
          projectId: permissionsGrantsProjects.projectId,
        })
        .from(permissionGrants)
        .where(eq(permissionGrants.identityId, identityId))
        .rightJoin(
          permissionsGrantsProjects,
          eq(permissionsGrantsProjects.permissionGrantId, permissionGrants.id),
        ),
      db
        .select({
          projectId: permissionsRulesProjects.projectId,
        })
        .from(permissionRules)
        .where(inArray(permissionRules.group, userGroups))
        .rightJoin(
          permissionsRulesProjects,
          eq(permissionsRulesProjects.permissionRuleId, permissionRules.id),
        ),
    ]);

    const uniqueProjectIds = [...new Set([...grants.map(({ projectId }) => projectId), ...groups.map(({ projectId }) => projectId)])];
    const appIds = await db.select({ appId: apps.id }).from(apps).where(inArray(apps.projectId, uniqueProjectIds))
    return {
      appIds: appIds.map(({ appId }) => appId),
      projectIds: uniqueProjectIds
    };
  },

  getAllowedGroups: async () => {
    const groups = await db
      .select({ group: permissionRules.group })
      .from(permissionRules);
    return new Set(groups.map(({ group }) => group));
  },

  delete: (id: string) => db.delete(permissionGrants).where(eq(permissionGrants.id, id)),
};
