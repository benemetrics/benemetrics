import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { issueDAO } from "db/dao/issues";
import { appDAO } from "db/dao/project";
import { toIssue } from "./serialize";

// Issues are created and kept up to date by ingestion; this surface only
// lists them and toggles their status (resolving an issue arms the
// "regression" alert trigger for its next occurrence).
export const issueRoutes = new Elysia({ prefix: "issues" })
  .get(
    "/",
    async ({ query: { appId, status, page, limit } }) => {
      if (appId) await appDAO.findByIdOrThrow(appId);
      const { data, pagination } = await issueDAO.listPaged({
        appId,
        status,
        page,
        limit,
      });
      return { data: data.map(toIssue), pagination };
    },
    {
      query: arktype({
        appId: "string.uuid?",
        status: "'unresolved' | 'resolved'?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) =>
      toIssue(await issueDAO.findByIdOrThrow(id)),
    { params: arktype({ id: "string.uuid" }) },
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) =>
      toIssue(await issueDAO.updateOrThrow(id, { status: body.status })),
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({ status: "'unresolved' | 'resolved'" }),
    },
  );
