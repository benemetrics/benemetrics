import { Elysia } from "elysia";
import { logAuthMode } from "./auth";
import { ApiError } from "./errors";
import ui from "../frontend/index.html";
import { eventsRoutes, ingestionRoutes } from "./events";
import { otlpRoutes } from "./otlp";
import { sourceMapUploadRoutes } from "./api0/source-maps";
import { storageRoutes } from "./storage";
import { replayRoutes } from "./replays";
import { evaluationRoutes } from "./evaluation";
import { flagsStreamRoutes } from "./flags-stream";
import { flagsV1Routes } from "./flags-v1";
import { adminRoutes } from "./admin";
import { startAlertSweeper } from "./alerting/evaluation";
import { initNats } from "./nats";
import { initClickHouse } from "./clickhouse";

const SERVER_PORT = Number(process.env.PORT) || 31337;

const app = new Elysia({
  serve: {
    routes: {
      "/ui": ui,
      "/ui/*": ui,
    },
  },
})
  .onError(({ code, error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.httpStatus;
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
    console.error(`[${code}] ${error instanceof Error ? error.message : String(error)}`);
    set.status = 500;
    return { error: "Internal Server Error" };
  })
  // Liveness probe for Docker/orchestration only. The UI does not read it:
  // dashboard counts come from the events API.
  .get("/health", () => ({ status: "ok" }))
  .get("/", () => Response.redirect("/ui"))
  .use(eventsRoutes)
  .use(ingestionRoutes)
  .use(otlpRoutes)
  .use(sourceMapUploadRoutes)
  .use(storageRoutes)
  .use(replayRoutes)
  .use(evaluationRoutes)
  .use(flagsStreamRoutes)
  .use(flagsV1Routes)
  .use(adminRoutes);

if (import.meta.main) {
  logAuthMode();
  app.listen(SERVER_PORT, async () => {
    console.log(`[Server] Sentry backend listening on port ${SERVER_PORT}`);
    try {
      // Boot order: NATS (stream + durable pull consumers) before
      // ClickHouse (engine tables + views). Both retry a few times and
      // then fail fast — the server never runs half-wired.
      await initNats();
      await initClickHouse();
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
