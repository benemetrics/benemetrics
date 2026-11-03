import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/apps";
import { resolveIdentity } from "../auth";

// ── oidc surface: the app reads, deletes and rotates its DSN key ────
export const appsRoutes = new Elysia({ prefix: "/api/admin/apps" })
  .resolve(resolveIdentity)
  .group(
    "/:appId",
    {
      params: arktype({ appId: "string.uuid" }),
    },
    (app) =>
      app
        .get("/", ({ params: { appId } }) => appDAO.findByIdOrThrow(appId))
        // Rotating invalidates the composed DSN immediately: old deployments
        // fail ingestion with 401 until they are redeployed with the new DSN.
        .post(
          "/rotate-key",
          ({ params: { appId } }) => appDAO.rotatePublicKey(appId),
        )
        .delete("/", ({ params: { appId } }) => appDAO.delete(appId)),
  );
