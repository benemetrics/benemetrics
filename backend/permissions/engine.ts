import { permissionGrantDAO } from "db/dao/permission-grants";
import type { resolveIdentity } from "backend/auth";
import { env } from "bun";


export const projectsAndAppsPermissions = async ({ user, store }: Awaited<ReturnType<typeof resolveIdentity>> & { store: any }) => {
  if (user.groups.has(env.OIDC_ADMIN_GROUP ?? 'admin')) return { perms: { projectIds: [] as string[], appIds: [] as string[] } };
  store[user.id] ??= await permissionGrantDAO.getUserGrantWithPermissions(user.id);
  return { perms: store[user.id] } as { perms: { projectIds: string[]; appIds: string[] } };
}