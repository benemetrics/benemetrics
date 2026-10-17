import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO, toAppResponse } from "db/dao/project";
import { storedEventDAO } from "db/dao/stored-event";
import { issueDAO } from "db/dao/issues";
import { releaseDAO } from "db/dao/releases";
import { sourceMapDAO } from "db/dao/source-maps";
import { sourceMapTokenDAO } from "db/dao/source-map-tokens";
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { alertChannelDAO } from "db/dao/alert-channels";

// Rows in project- or
// globally-scoped tables (feature flags, global alert
// rules/channels) are shared and stay in place.
export async function deleteAppCascade(appId: string): Promise<void> {
  await storedEventDAO.deleteByApp(appId);
  await issueDAO.deleteByApp(appId);
  await releaseDAO.deleteByApp(appId);
  await sourceMapDAO.deleteByApp(appId);
  await sourceMapTokenDAO.deleteByApp(appId);
  await alertRuleDAO.deleteByApp(appId);
  await alertIncidentDAO.deleteByApp(appId);
  await alertChannelDAO.deleteByApp(appId);
  await appDAO.delete(appId);
}

export const appsRoutes = new Elysia({ prefix: "apps" })
  .get(
    "/:appId",
    async ({ params: { appId } }) => toAppResponse(await appDAO.findByIdOrThrow(appId)),
    { params: arktype({ appId: "string.uuid" }) },
  )
  .delete(
    "/:appId",
    async ({ params: { appId } }) => {
      await appDAO.findByIdOrThrow(appId);
      await deleteAppCascade(appId);
      return { success: true };
    },
    { params: arktype({ appId: "string.uuid" }) },
  );
