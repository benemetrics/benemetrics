import { Elysia } from "elysia";
import { appsRoutes } from "./apps";
import { issueRoutes } from "./issues";
import { projectRoutes } from "./projects";
import { releaseRoutes } from "./releases";
import { settingsRoutes } from "./settings";
import { permissionRoutes } from "./permissions";
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
  .use(settingsRoutes)
  .use(permissionRoutes)
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
