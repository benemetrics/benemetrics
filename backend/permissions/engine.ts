import { appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { permissionGrantDAO } from "db/dao/permission-grants";
import { permissionRuleDAO } from "db/dao/permission-rules";
import { forbidden, unauthorized } from "backend/errors";
import type { PermissionScope } from "../protocol/permissions";

export const NO_READ_PERMISSION_MESSAGE =
  "No read permission is configured for this account — ask an admin to grant access, or provide the admin token";

export interface ScopedView {
  /** The apps a scoped identity may see. */
  appIds: Set<string>;
  /** The environments a scoped identity may see. */
  environmentIds: Set<string>;
  /** The projects a scoped identity may see. */
  projectIds: Set<string>;
}

/** The unrestricted view — the admin token sees everything. */
export const UNRESTRICTED_VIEW: ScopedView = {
  appIds: new Set(),
  environmentIds: new Set(),
  projectIds: new Set(),
};

function union(values: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of values) {
    for (const value of list) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(value);
    }
  }
  return merged;
}

export interface ResolvedAccess {
  /** The read scope. */
  scope: PermissionScope;
  /** The identity may perform the admin writes. */
  canWrite: boolean;
}

/**
 * The access of an identity: the enabled grant for its id wins
 * exclusively, otherwise the union of the enabled group rules it matches.
 * A disabled grant falls through to the group rules; an enabled grant
 * with an empty scope is a valid "read nothing" grant. Only a grant
 * carries the write access — the group rules grant reads.
 */
export async function resolveAccessForIdentity(identity: {
  id: string;
  groups: string[];
}): Promise<ResolvedAccess | null> {
  const grant = await permissionGrantDAO.findByIdentityId(identity.id);
  if (grant?.isEnabled) {
    return {
      scope: { environments: grant.environments, appPrefixes: grant.appPrefixes },
      canWrite: grant.canWrite,
    };
  }

  const groups = new Set(identity.groups.map((group) => group.toLowerCase()));
  const rules = (await permissionRuleDAO.listEnabled()).filter((rule) =>
    groups.has(rule.name.toLowerCase()),
  );
  if (rules.length === 0) return null;

  return {
    scope: {
      environments: union(rules.map((rule) => rule.environments)),
      appPrefixes: union(rules.map((rule) => rule.appPrefixes)),
    },
    canWrite: false,
  };
}

/**
 * The scope of an identity: the enabled grant for its id wins
 * exclusively, otherwise the union of the enabled group rules it matches.
 */
export async function resolveScopeForIdentity(identity: {
  id: string;
  groups: string[];
}): Promise<PermissionScope | null> {
  const access = await resolveAccessForIdentity(identity);
  return access?.scope ?? null;
}

/**
 * The visible topology for a scope: an app is visible when its name
 * starts with a permitted prefix or its environment name is permitted; an
 * environment is visible when its name is permitted or it holds a visible
 * app; a project is visible when it holds a visible app or environment.
 */
export async function computeScopedView(scope: PermissionScope): Promise<ScopedView> {
  const environments = await environmentDAO.listAll();
  const apps = await appDAO.listAll();

  const environmentNames = new Set(
    scope.environments.map((name) => name.toLowerCase()),
  );
  const appPrefixes = scope.appPrefixes.map((prefix) => prefix.toLowerCase());

  const environmentById = new Map(environments.map((environment) => [environment.id, environment]));

  const appIds = new Set<string>();
  for (const app of apps) {
    const environment = environmentById.get(app.environmentId);
    const environmentGranted = environment
      ? environmentNames.has(environment.name.toLowerCase())
      : false;
    const prefixGranted = appPrefixes.some((prefix) =>
      app.name.toLowerCase().startsWith(prefix),
    );
    if (environmentGranted || prefixGranted) appIds.add(app.id);
  }

  const environmentIds = new Set<string>();
  for (const environment of environments) {
    if (environmentNames.has(environment.name.toLowerCase())) {
      environmentIds.add(environment.id);
      continue;
    }
    const holdsVisibleApp = apps.some(
      (app) => app.environmentId === environment.id && appIds.has(app.id),
    );
    if (holdsVisibleApp) environmentIds.add(environment.id);
  }

  const projectIds = new Set<string>();
  for (const app of apps) {
    if (appIds.has(app.id)) projectIds.add(app.projectId);
  }
  for (const environment of environments) {
    if (environmentIds.has(environment.id)) projectIds.add(environment.projectId);
  }

  return { appIds, environmentIds, projectIds };
}

const views = new WeakMap<Request, ScopedView>();

/**
 * The view of a request: the admin token is unrestricted (null), a scoped
 * identity sees only its grants. The view is computed once per request.
 */
export async function scopedViewFor(context: {
  request: Request;
  isAdmin: boolean;
  adminScope: PermissionScope | null;
}): Promise<ScopedView | null> {
  if (context.isAdmin) return null;
  if (!context.adminScope) throw unauthorized(NO_READ_PERMISSION_MESSAGE);
  const cached = views.get(context.request);
  if (cached) return cached;
  const view = await computeScopedView(context.adminScope);
  views.set(context.request, view);
  return view;
}

/** Scoped identities are read-only. */
export function requireAdmin(context: { isAdmin: boolean }): void {
  if (!context.isAdmin) {
    throw forbidden("Scoped identities are read-only");
  }
}

/** The detail reads a scoped identity may perform. */
const SCOPED_READ_PATHS: RegExp[] = [
  /^\/api\/admin\/session$/,
  /^\/api\/admin\/projects$/,
  /^\/api\/admin\/projects\/[^/]+$/,
  /^\/api\/admin\/projects\/[^/]+\/apps$/,
  /^\/api\/admin\/environments$/,
  /^\/api\/admin\/environments\/[^/]+$/,
  /^\/api\/admin\/issues$/,
  /^\/api\/admin\/issues\/[^/]+$/,
  /^\/api\/admin\/issues\/[^/]+\/events$/,
  /^\/api\/admin\/issues\/[^/]+\/stats$/,
  /^\/events$/,
  /^\/events\/[^/]+$/,
];

export function isScopedReadPath(path: string): boolean {
  return SCOPED_READ_PATHS.some((pattern) => pattern.test(path));
}

/** A scoped identity may only read the allowlisted paths. */
export function requireScopedRead(request: Request): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw forbidden("Scoped identities are read-only");
  }
  if (!isScopedReadPath(new URL(request.url).pathname)) {
    throw forbidden("Scoped identities are read-only");
  }
}
