import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { segmentDAO } from "db/dao/segments";
import { targetingRuleSchema } from "backend/protocol/feature-flags";
import { resolveAdminId } from "../auth";

// ── oidc surface: the admin reads and writes ─────────────
export const segmentRoutes = new Elysia({
  prefix: "/api/admin/feature-flags/segments",
})
  .resolve(resolveAdminId)
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
        rules: targetingRuleSchema.array(),
      }),
    },
  )
  .get("/", async ({ query }) => segmentDAO.list({ ...query }), {
    query: arktype({
      cursor: "string?",
      limit: "string.integer.parse?",
    }),
  })
  .get("/:id", async ({ params: { id } }) => segmentDAO.findByIdOrThrow(id), {
    params: arktype({ id: "string.uuid" }),
  });
