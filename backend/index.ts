import { Elysia } from "elysia";
import "./arktype-config";
import { ApiError } from "./errors";
import ui from "../frontend/index.html";
import { apiRoutes } from "./routes";
import { startAlertSweeper } from "./alerting/evaluation";
import { initClickHouse } from "./clickhouse";
import { assertStorageConfigured } from "./storage";
import { cron } from "@elysiajs/cron";
import { generateAdminToken } from "./auth";
import { startAuthCallout } from "./nats-auth-callout";
import { nats } from "./nats";
import { join } from "node:path";
import { permissionGrantDAO } from "db/dao/permissions/grants";

const SERVER_PORT = Number(process.env.PORT) || 31337;

const app = new Elysia({
  serve: {
    maxRequestBodySize: 12 * 1024 * 1024,
    routes: {
      "/ui": ui,
      "/ui/*": ui,
    },
  },
})
  .state("allowedGroups", await permissionGrantDAO.getAllowedGroups())
  .onError(({ code, error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.httpStatus;
      if (error.rateLimit) {
        set.headers["Retry-After"] = String(error.rateLimit.retryAfter);
        set.headers["X-Sentry-Rate-Limits"] =
          `${error.rateLimit.retryAfter}:${error.rateLimit.categories}:${error.rateLimit.scope}`;
      }
      return { error: error.message };
    }
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "Invalid request", details: error };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "Not found" };
    }
    console.error(
      `[${code}] ${error instanceof Error ? error.message : String(error)}`,
    );
    set.status = 500;
    return { error: "Internal Server Error" };
  })
  .get("/", () => Response.redirect("/ui"))
  // public/ assets referenced from the root (favicon, robots.txt)
  .get(
    "/favicon.ico",
    () =>
      new Response(
        Bun.file(join(import.meta.dir, "../frontend/public/favicon.ico")),
      ),
  )
  .get(
    "/robots.txt",
    () =>
      new Response(
        Bun.file(join(import.meta.dir, "../frontend/public/robots.txt")),
      ),
  )
  .use(apiRoutes);

if (import.meta.main) {
  app.listen(SERVER_PORT, async () => {
    console.log(`[Server] Sentry backend listening on port ${SERVER_PORT}`);
    try {
      assertStorageConfigured();
      await initClickHouse();
      startAuthCallout(nats, () => app.store.adminTokenHash);
    } catch (err) {
      console.error(
        "[Server] Failed to initialize required services:",
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
    startAlertSweeper();
  });
}

export type App = typeof app;

export default app;
