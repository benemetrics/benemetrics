import { Elysia } from "elysia";
import { adminRoutes } from "./admin/index.ts";
import { eventsRoutes } from "./events/index.ts";
import { ingestionRoutes } from "./events/ingestion-routes.ts";
import { featureFlagRoutes } from "./featureFlags/index.ts";
import { evaluationRoutes } from "./evaluation/index.ts";
import { flagsV1Routes } from "./flags-v1/index.ts";
import { startAlertSweeper } from "./alerting/evaluation.ts";
import { initNats } from "./nats.ts";
import { initClickHouse } from "./clickhouse.ts";

const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .use(eventsRoutes)
  .use(ingestionRoutes)
  .use(featureFlagRoutes)
  .use(evaluationRoutes)
  .use(flagsV1Routes)
  .use(adminRoutes)
  .onError(({ code, error, set }) => {
    if (error instanceof Error && "httpStatus" in error) {
      set.status = (error as any).httpStatus;
      return { error: error.message };
    }
    console.error(`[${code}] ${error?.message || error}`);
    set.status = 500;
    return { error: "Internal Server Error" };
  });

async function bootstrap() {
  const enforced = !!process.env.ADMIN_TOKEN || !!process.env.OIDC_ISSUER || !!process.env.OAUTH_ISSUER || process.env.NODE_ENV === "production";
  console.log(`Auth mode: ${enforced ? "enforced" : "open"}`);
  await initNats();
  await initClickHouse();
  await startAlertSweeper();
}

bootstrap().catch(err => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});

export { app };