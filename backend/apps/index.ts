import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { issueDAO } from "db/dao/issues";
import { resolveAdminId } from "../auth";

// ── oidc surface: the app reads and deletes ────────────────────
export const appsRoutes = new Elysia({ prefix: "/api/admin/apps" })
  .resolve(resolveAdminId)
  .get(
    "/:appId",
    async ({ params: { appId } }) => appDAO.findByIdOrThrow(appId),
    { params: arktype({ appId: "string.uuid" }) },
  )
  .delete(
    "/:appId",
    async ({ params: { appId } }) => {
      // The environment is shared and survives the app.
      await issueDAO.deleteByApp(appId);
      await appDAO.delete(appId);
      return { success: true };
    },
    { params: arktype({ appId: "string.uuid" }) },
  );
