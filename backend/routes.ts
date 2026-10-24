import { Elysia } from "elysia";
import { adminTokenStore } from "./admin-token";
import { appsRoutes } from "./apps";
import { environmentRoutes } from "./environments";
import { issueRoutes } from "./issues";
import { projectRoutes } from "./projects";
import { releaseRoutes } from "./releases";
import { segmentRoutes } from "./segments";
import { settingsRoutes } from "./settings";
import { permissionRoutes, sessionRoutes } from "./permissions";
import { alertingRoutes } from "./alerting";
import { metricsRoutes } from "./metrics";
import { eventsRoutes, ingestionRoutes, replayRoutes } from "./events";
import { otlpRoutes } from "./otlp";
import {
  evaluationRoutes,
  experimentRoutes,
  featureFlagRoutes,
  flagsStreamRoutes,
  flagsV1Routes,
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
  .use(adminTokenStore)
  .use(appsRoutes)
  .use(environmentRoutes)
  .use(issueRoutes)
  .use(projectRoutes)
  .use(releaseRoutes)
  .use(segmentRoutes)
  .use(settingsRoutes)
  .use(permissionRoutes)
  .use(sessionRoutes)
  .use(alertingRoutes)
  .use(metricsRoutes)
  .use(featureFlagRoutes)
  .use(experimentRoutes)
  .use(sourceMapRoutes)
  .use(sourceMapTokenRoutes)
  .use(sourceMapUploadRoutes)
  .use(eventsRoutes)
  .use(replayRoutes)
  .use(ingestionRoutes)
  .use(otlpRoutes)
  .use(evaluationRoutes)
  .use(flagsStreamRoutes)
  .use(flagsV1Routes);
