import { Elysia } from "elysia";
import { type } from "arktype";
import { segmentDAO } from "../../../db/dao/segments.ts";

export const segmentRoutes = new Elysia({ prefix: "segments" })
  .post(
    "/",
    async ({ body }) => await segmentDAO.create({ name: body.name, description: body.description, rules: body.rules }),
    { body: type({ name: "string", description: "string?", rules: "unknown[]" }) }
  )
  .get(
    "/",
    async ({ query }) => {
      const { data, pagination } = await segmentDAO.list({ page: query.page, limit: query.limit });
      return { data, pagination };
    },
    { query: type({ page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => await segmentDAO.findByIdOrThrow(id),
    { params: type({ id: "string.uuid" }) }
  );