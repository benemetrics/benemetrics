import { Elysia } from "elysia";
import { type } from "arktype";
import { environmentDAO } from "../../../db/dao/environments.ts";
import { badRequest } from "../../errors.ts";

export const environmentRoutes = new Elysia({ prefix: "environments" })
  .post(
    "/",
    async ({ body }) => {
      return await environmentDAO.create({
        projectId: body.projectId,
        name: body.name,
        slug: body.slug,
        isDefault: body.isDefault,
      });
    },
    { body: type({ projectId: "string.uuid", name: "string", slug: "string?", isDefault: "boolean?" }) }
  )
  .get(
    "/",
    async ({ query }) => await environmentDAO.listByProject(query.projectId, { page: query.page, limit: query.limit }),
    { query: type({ projectId: "string.uuid", page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => await environmentDAO.findByIdOrThrow(id),
    { params: type({ id: "string.uuid" }) }
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => await environmentDAO.updateOrThrow(id, body),
    { params: type({ id: "string.uuid" }), body: type({ name: "string?", slug: "string?", isDefault: "boolean?" }) }
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => { await environmentDAO.delete(id); return { success: true }; },
    { params: type({ id: "string.uuid" }) }
  );