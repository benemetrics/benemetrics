import { permissionGrantDAO } from "db/dao/permission-grants";
import type { resolveIdentity } from "backend/auth";
import { env } from "bun";


export const projectsAndAppsPermissions = async ({ user, store }: Awaited<ReturnType<typeof resolveIdentity>> & { store: any }) => {
  if (user.groups.includes(env.OIDC_ADMIN_GROUP ?? 'admin')) return { projectIds: [], appsIds: [] };
  store[user.id] ??= await permissionGrantDAO.getUserGrantWithPermissions(user.id);
  return store[user.id] as { projectIds: number[]; appIds: number[] };
}