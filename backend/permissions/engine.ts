// permission-grants DAO no longer exists; permission_audit table not provisioned
import type { resolveIdentity } from "backend/auth";
import { env } from "bun";
import { permissionGrantDAO } from "../../db/dao/permissions/grants";
import { cache } from "backend/cache";

export const projectsAndAppsPermissions = async ({ user }: Awaited<ReturnType<typeof resolveIdentity>>) => {
  const { write, value } = await cache.PERMISSIONS(user.id);
  if (value) return { perms: value };

  if (user.groups.has(env.OIDC_ADMIN_GROUP ?? "admin")) 
      return { perms: await write(permissionGrantDAO.getAdminGrantWithPermissions(user.id, [...user.groups])) };
  return { perms: await write(permissionGrantDAO.getUserGrantWithPermissions(user.id, [...user.groups])) };
};