import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { segmentDAO } from "db/dao/segments";

export const segmentRoutes = new Elysia({ prefix: "segments" })
  .post(
    "/",
    async ({ body }) =>
      segmentDAO.create({
        name: body.name,
        description: body.description || "",
        rules: JSON.stringify(body.rules),
      }),
    {
      body: arktype({
        name: "string",
        description: "string?",
        rules: "Array",
      }),
    },
  )
  .get(
    "/",
    async ({ query }) => segmentDAO.list({ page: query.page, limit: query.limit }),
    {
      query: arktype({
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get("/:id", async ({ params: { id } }) => segmentDAO.findByIdOrThrow(id), {
    params: arktype({ id: "string.uuid" }),
  });
