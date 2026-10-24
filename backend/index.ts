import { Elysia } from "elysia";
import "./arktype-config";
import { ApiError } from "./errors";
import ui from "../frontend/index.html";
import { apiRoutes } from "./routes";
import { startAlertSweeper } from "./alerting/evaluation";
import { startDeadLetterWorker } from "./alerting/dead-letters";
import { initClickHouse } from "./clickhouse";
import { assertStorageConfigured } from "./storage";

const SERVER_PORT = Number(process.env.PORT) || 31337;

const app = new Elysia({
  serve: {
    // The server-wide body bound: generous enough for the 10 MB source-map
    // upload, small enough that no request can exhaust the process.
    maxRequestBodySize: 12 * 1024 * 1024,
    routes: {
      "/ui": ui,
      "/ui/*": ui,
    },
  },
})
  .onError(({ code, error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.httpStatus;
      // A rate-limited answer carries the Sentry-compatible headers so the
      // SDKs' own client limiter backs off.
      if (error.rateLimit) {
        set.headers["Retry-After"] = String(error.rateLimit.retryAfter);
        set.headers["X-Sentry-Rate-Limits"] = `${error.rateLimit.retryAfter}:${error.rateLimit.categories}:${error.rateLimit.scope}`;
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
    console.error(`[${code}] ${error instanceof Error ? error.message : String(error)}`);
    set.status = 500;
    return { error: "Internal Server Error" };
  })
  .get("/", () => Response.redirect("/ui"))
  .use(apiRoutes);

if (import.meta.main) {
  app.listen(SERVER_PORT, async () => {
    console.log(`[Server] Sentry backend listening on port ${SERVER_PORT}`);
    try {
      // NATS is connected when `./nats` is imported (publish side). The
      // stream and its durable consumers belong to `backend/consumer.ts`;
      // ClickHouse attaches its engine tables to those durables here.
      assertStorageConfigured();
      await initClickHouse();
    } catch (err) {
      console.error(
        "[Server] Failed to initialize required services:",
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
    startAlertSweeper();
    startDeadLetterWorker();
  });
}

export type App = typeof app;

export default app;
