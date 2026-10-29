import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/app";
import { resolveIdentity } from "../auth";

// ── oidc surface: the app reads and deletes ────────────────────
export const appsRoutes = new Elysia({ prefix: "/api/admin/apps" })
  .resolve(resolveIdentity)
  .post(
    "", 
    ({ body }) => appDAO.create({ ...body, publicKey: crypto.randomUUID().replace(/-/g, "").slice(0, 32) }),
    {
      body: arktype({
        name: "string",
        platform: "string",
        projectId: "string.uuid",
      }),
    }
  )
  .group(
    "/:appId",
    {
      params: arktype({ appId: "string.uuid" }),
    },
    (app) =>
      app
        .get("/", ({ params: { appId } }) => appDAO.findByIdOrThrow(appId))
        .delete("/", ({ params: { appId } }) => appDAO.delete(appId)),
  );
