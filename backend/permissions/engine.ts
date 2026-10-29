// permission-grants DAO no longer exists; permission_audit table not provisioned
import type { resolveIdentity } from "backend/auth";
import { env } from "bun";

export const projectsAndAppsPermissions = async ({
  user,
  store,
}: Awaited<ReturnType<typeof resolveIdentity>> & { store: any }) => {
  if (user.groups.has(env.OIDC_ADMIN_GROUP ?? "admin"))
    return { perms: { projectIds: [] as string[], appIds: [] as string[] } };
  // permission-grants DAO no longer exists; return empty permissions
  return { perms: { projectIds: [] as string[], appIds: [] as string[] } };
};

export async function scopedViewFor({
  request,
  isAdmin,
  adminScope,
}: {
  request: any;
  isAdmin: boolean;
  adminScope: any;
}): Promise<{ appIds: Set<string> } | null> {
  if (isAdmin) return null;
  return { appIds: new Set<string>() };
}
