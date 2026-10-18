import { Elysia } from "elysia";
import { type } from "arktype";
import { sourceMapTokenDAO } from "../../db/dao/source-map-tokens.ts";

export const sourceMapTokenRoutes = new Elysia({ prefix: "source-map-tokens" })
  .post(
    "/",
    async ({ body }) => {
      const { token, record } = await sourceMapTokenDAO.create({
        name: body.name,
        projectId: body.projectId,
        appId: body.appId,
        environmentId: body.environmentId,
        createdBy: "admin",
        expiresAt: body.expiresAt,
      });
      return { ...record, token };
    },
    { body: type({ name: "string", projectId: "string.uuid", appId: "string.uuid", environmentId: "string.uuid", expiresAt: "string?" }) }
  )
  .get(
    "/",
    async ({ query }) => {
      const { data, pagination } = await sourceMapTokenDAO.list({ projectId: query.projectId, environmentId: query.environmentId, page: query.page, limit: query.limit });
      return { data: data.map(t => ({ id: t.id, name: t.name, projectId: t.projectId, appId: t.appId, environmentId: t.environmentId, tokenPrefix: t.tokenPrefix, createdBy: t.createdBy, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt })), pagination };
    },
    { query: type({ projectId: "string.uuid?", environmentId: "string.uuid?", page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      const token = await sourceMapTokenDAO.findByIdOrThrow(id);
      return { id: token.id, name: token.name, projectId: token.projectId, appId: token.appId, environmentId: token.environmentId, tokenPrefix: token.tokenPrefix, createdBy: token.createdBy, createdAt: token.createdAt, lastUsedAt: token.lastUsedAt, expiresAt: token.expiresAt, revokedAt: token.revokedAt };
    },
    { params: type({ id: "string.uuid" }) }
  )
  .post(
    "/:id/rotate",
    async ({ params: { id } }) => {
      const { token, record } = await sourceMapTokenDAO.rotate(id);
      return { ...record, token };
    },
    { params: type({ id: "string.uuid" }) }
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => { await sourceMapTokenDAO.revoke(id); return { success: true }; },
    { params: type({ id: "string.uuid" }) }
  );