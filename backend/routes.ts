import { Elysia } from "elysia";
import { appsRoutes } from "./apps";
import { issueRoutes } from "./issues";
import { projectRoutes } from "./projects";
import { releaseRoutes } from "./releases";
import { permissionRoutes } from "./permissions";
import { alertingRoutes } from "./alerting";
import { notificationRoutes } from "./notifications";
import { metricsRoutes } from "./metrics";
import {
  evaluationRoutes,
  experimentRoutes,
  featureFlagRoutes,
  flagsStreamRoutes,
  flagsV1Routes,
  segmentRoutes,
} from "./feature-flags";
import {
  sourceMapRoutes,
  sourceMapTokenRoutes,
  sourceMapUploadRoutes,
} from "./source-maps";

// The HTTP surface, one group per domain. Each domain file keeps its
// own credential surface (public, dsn or oidc) and guards the groups that
// need one; the oidc groups resolve the identity through `oidcGuard`.
export const apiRoutes = new Elysia()
  .use(appsRoutes)
  .use(issueRoutes)
  .use(projectRoutes)
  .use(releaseRoutes)
  .use(segmentRoutes)
  .use(permissionRoutes)
  .use(alertingRoutes)
  .use(notificationRoutes)
  .use(metricsRoutes)
  .use(featureFlagRoutes)
  .use(experimentRoutes)
  .use(sourceMapRoutes)
  .use(sourceMapTokenRoutes)
  .use(sourceMapUploadRoutes)
  .use(flagsStreamRoutes)
  .use(flagsV1Routes)
  .use(evaluationRoutes);
