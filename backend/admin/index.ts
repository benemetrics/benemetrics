import { Elysia } from "elysia";
import { type } from "arktype";
import { requireReadAccess, scopedViewFor, isScopedReadPath } from "../permissions.ts";
import { notFound, forbidden, unauthorized } from "../errors.ts";
import { projectRoutes } from "./projects/index.ts";
import { permissionRoutes } from "./permissions/index.ts";
import { segmentRoutes } from "./segments/index.ts";
import { environmentRoutes } from "./environments/index.ts";
import { releaseRoutes } from "./releases/index.ts";
import { issueRoutes } from "./issues/index.ts";
import { settingsRoutes } from "./settings/index.ts";
import { featureFlagRoutes } from "../featureFlags/index.ts";
import { alertingRoutes } from "../protocol/alerting.ts";
import { sourceMapRoutes } from "../../db/dao/source-maps.ts";
import { sourceMapTokenRoutes } from "../../db/dao/source-map-tokens.ts";
import * as jose from "jose";

const SCOPED_READ_PATHS = new Set([
  "/api/admin/projects",
  "/api/admin/projects/:id",
  "/api/admin/projects/:id/apps",
  "/api/admin/environments",
  "/api/admin/environments/:id",
  "/api/admin/issues",
  "/api/admin/issues/:id",
]);

function adminAuthEnforced() { return !!process.env.ADMIN_TOKEN || !!process.env.OIDC_ISSUER || !!process.env.OAUTH_ISSUER || process.env.NODE_ENV === "production"; }

async function validateAdminAuth(request: Request) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminToken))) return { id: "admin", email: "admin@local", name: "Admin", groups: ["admin"] };
  const issuer = process.env.OIDC_ISSUER || process.env.OAUTH_ISSUER;
  if (issuer) {
    try {
      const { payload } = await import("jose").then(m => m.jwtVerify(token, import("jose").then(m => m.createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))), {
        issuer, audience: process.env.OIDC_AUDIENCE || process.env.OAUTH_CLIENT_ID, clockTolerance: 60
      }));
      const p = payload as any;
      return { id: p.sub, email: p[process.env.OIDC_EMAIL_CLAIM || "email"], name: p[process.env.OIDC_NAME_CLAIM || "name"] || p.preferred_username || p.upn || "Unknown", groups: (p[process.env.OIDC_GROUPS_CLAIM || "groups"]) || [] };
    } catch {}
  }
  return null;
}

function isScopedReadPath(path: string): boolean {
  for (const allowed of SCOPED_READ_PATHS) {
    const regex = new RegExp(`^${allowed.replace(":id", "[^/]+")}$`);
    if (regex.test(path)) return true;
  }
  return false;
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

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .derive(async ({ request }) => {
    if (!adminAuthEnforced()) return {};
    const admin = await validateAdminAuth(request);
    if (!admin) throw unauthorized("Invalid token");
    return { access: await scopedViewFor(request) };
  })
  .onBeforeHandle(async ({ request, access, set }) => {
    if (!adminAuthEnforced()) return;
    if (!access) { set.status = 401; return { error: "Unauthorized" }; }
  })
  .onBeforeHandle(async ({ request, access, set, path }) => {
    if (!adminAuthEnforced()) return;
    if (!access) return;
    const isScoped = isScopedReadPath(path);
    if (!isScoped && access.appIds.size === 0) { set.status = 403; return { error: "This endpoint requires the admin token" }; }
  })
  .use(projectRoutes)
  .use(permissionRoutes)
  .use(segmentRoutes)
  .use(environmentRoutes)
  .use(releaseRoutes)
  .use(issueRoutes)
  .use(settingsRoutes)
  .use(featureFlagRoutes)
  .use(alertingRoutes)
  .use(sourceMapRoutes)
  .use(sourceMapTokenRoutes);