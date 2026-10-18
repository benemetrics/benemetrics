import { Elysia } from "elysia";
import { type } from "arktype";
import { releaseDAO } from "../../../db/dao/releases.ts";

export const releaseRoutes = new Elysia({ prefix: "releases" })
  .get(
    "/",
    async ({ query }) => {
      // List releases
      return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    },
    { query: type({ appId: "string.uuid?", page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => ({ id, version: "1.0.0", status: "finalized" }),
    { params: type({ id: "string.uuid" }) }
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => await releaseDAO.updateOrThrow(id, body),
    { params: type({ id: "string.uuid" }), body: type({ status: "'draft' | 'finalized' | 'released'" }) }
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => { return { success: true }; },
    { params: type({ id: "string.uuid" }) }
  )
  .post(
    "/:id/finalize",
    async ({ params: { id } }) => await releaseDAO.updateOrThrow(id, { status: "finalized" }),
    { params: type({ id: "string.uuid" }) }
  );