import { Elysia } from "elysia";
import { type } from "arktype";
import { issueDAO } from "../../../db/dao/issues.ts";

export const issueRoutes = new Elysia({ prefix: "issues" })
  .get(
    "/",
    async ({ query }) => {
      return await issueDAO.list({
        appId: query.appId,
        projectId: query.projectId,
        status: query.status,
        search: query.search,
        page: query.page,
        limit: query.limit,
      });
    },
    {
      query: type({
        appId: "string.uuid?",
        projectId: "string.uuid?",
        status: "'unresolved' | 'resolved'?",
        search: "string?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => await issueDAO.findByIdOrThrow(id),
    { params: type({ id: "string.uuid" }) }
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => await issueDAO.updateOrThrow(id, body),
    { params: type({ id: "string.uuid" }), body: type({ status: "'unresolved' | 'resolved'" }) }
  );