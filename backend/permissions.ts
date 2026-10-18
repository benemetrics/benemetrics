import { permissionRuleDAO } from "../db/dao/permission-rules.ts";
import { permissionUserDAO } from "../db/dao/permission-users.ts";

export interface ScopedView {
  appIds: Set<string>;
  environmentIds: Set<string>;
  projectIds: Set<string>;
}

const viewCache = new Map<string, ScopedView>();

export async function resolveScopeForIdentity(email: string, groups: string[]): Promise<{
  environments: string[];
  appPrefixes: string[];
}> {
  // Check whitelist first
  const whitelist = await permissionUserDAO.findByEmail(email);
  if (whitelist && whitelist.isEnabled) {
    return {
      environments: JSON.parse(whitelist.environments),
      appPrefixes: JSON.parse(whitelist.appPrefixes),
    };
  }

  // Union of group rules
  const allRules = await permissionRuleDAO.list();
  const matchingRules = allRules.filter((rule) =>
    rule.isEnabled && groups.some((g) => g.toLowerCase() === rule.groupName.toLowerCase())
  );

  const environments = new Set<string>();
  const appPrefixes = new Set<string>();

  for (const rule of matchingRules) {
    const envs = JSON.parse(rule.environments);
    const prefixes = JSON.parse(rule.appPrefixes);
    envs.forEach((e: string) => environments.add(e));
    prefixes.forEach((p: string) => appPrefixes.add(p));
  }

  return {
    environments: Array.from(environments),
    appPrefixes: Array.from(appPrefixes),
  };
}

export async function computeScopedView(scope: { environments: string[]; appPrefixes: string[] }): Promise<{
  appIds: Set<string>;
  environmentIds: Set<string>;
  projectIds: Set<string>;
}> {
  // This would need to query apps/environments/projects
  // For now return empty sets - implement based on actual DAOs
  return {
    appIds: new Set(),
    environmentIds: new Set(),
    projectIds: new Set(),
  };
}

export async function scopedViewFor(request: Request): Promise<{
  appIds: Set<string>;
  environmentIds: Set<string>;
  projectIds: Set<string>;
} | null> {
  // Check cache
  const cacheKey = request.headers.get("Authorization") || "";
  const cached = viewCache.get(cacheKey);
  if (cached) return cached;

  // This would be implemented with actual DAO calls
  const view = { appIds: new Set<string>(), environmentIds: new Set<string>(), projectIds: new Set<string>() };
  viewCache.set(cacheKey, view);
  return view;
}

export async function requireReadAccess(request: Request): Promise<void> {
  // Implementation would check if request has valid auth
  // For now, just pass through
}

const SCOPED_READ_PATHS = new Set([
  "/api/admin/projects",
  "/api/admin/projects/:id",
  "/api/admin/projects/:id/apps",
  "/api/admin/environments",
  "/api/admin/environments/:id",
  "/api/admin/issues",
  "/api/admin/issues/:id",
]);

export function isScopedReadPath(path: string): boolean {
  for (const allowed of SCOPED_READ_PATHS) {
    const regex = new RegExp(`^${allowed.replace(":id", "[^/]+")}$`);
    if (regex.test(path)) return true;
  }
  return false;
}