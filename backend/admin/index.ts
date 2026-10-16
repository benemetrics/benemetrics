import { Elysia } from "elysia";
import { unauthorized } from "backend/errors";
import { featureFlagRoutes } from "../featureFlags";
import { experimentRoutes } from "../experiments";
import { projectRoutes } from "./projects";
import { appsRoutes } from "./apps";
import { segmentRoutes } from "./segments";
import { environmentRoutes } from "./environments";
import { releaseRoutes } from "./releases";
import { sourceMapTokenRoutes } from "./source-map-tokens";
import { sourceMapRoutes } from "./source-maps";
import { alertingRoutes } from "../alerting";
import { validateAdminAuth } from "../auth";

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .derive(({ request }) => {
    const auth = validateAdminAuth(request);
    return { adminUser: auth.user, adminError: auth.error };
  })
  // Fail closed: an invalid or missing token stops the request before any
  // route handler runs.
  .onBeforeHandle(({ adminUser, adminError }) => {
    if (adminUser) return;
    throw unauthorized(adminError);
  })
  .get("/me", ({ adminUser }) => adminUser ?? null)
  .use(featureFlagRoutes)
  .use(experimentRoutes)
  .use(projectRoutes)
  .use(appsRoutes)
  .use(segmentRoutes)
  .use(environmentRoutes)
  .use(releaseRoutes)
  .use(sourceMapTokenRoutes)
  .use(sourceMapRoutes)
  .use(alertingRoutes);
