import { Elysia } from "elysia";
import { badRequest, notFound } from "backend/errors";
import { type as arktype } from "arktype";
import { projectDAO, appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { sourceMapTokenDAO } from "db/dao/source-map-tokens";
import { validateAdminAuth } from "../../auth";
import type { SourceMapToken } from "db/schema/source-map-tokens";
import type {
  SourceMapTokenResponse,
  SourceMapTokenWithSecret,
} from "../../protocol/source-map";

function toTokenResponse(token: SourceMapToken): SourceMapTokenResponse {
  return {
    id: token.id,
    name: token.name,
    projectId: token.projectId,
    appId: token.appId,
    environmentId: token.environmentId,
    tokenPrefix: token.tokenPrefix,
    createdBy: token.createdBy,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
  };
}

// Admin-only management of source map upload tokens
// (sentry-cli SENTRY_AUTH_TOKEN). Tokens are scoped to
// one project + environment, stored hashed, and the raw
// value is returned exactly once (create / rotate).
export const sourceMapTokenRoutes = new Elysia({
  prefix: "source-map-tokens",
})
  .post(
    "/",
    async ({ body, request }) => {
      await projectDAO.findByIdOrThrow(body.projectId);

      const admin = await validateAdminAuth(request);

      const environment = await environmentDAO.findByIdOrThrow(
        body.environmentId,
      );
      if (environment.projectId !== body.projectId) {
        throw badRequest("Environment does not belong to this project");
      }

      const app = await appDAO.findByIdOrThrow(body.appId);
      if (app.projectId !== body.projectId) {
        throw badRequest("App does not belong to this project");
      }

      const { token, record } = await sourceMapTokenDAO.create({
        name: body.name,
        projectId: body.projectId,
        appId: body.appId,
        environmentId: body.environmentId,
        createdBy: admin.user?.id ?? "admin",
        expiresAt: body.expiresAt ?? null,
      });

      const response: SourceMapTokenWithSecret = {
        ...toTokenResponse(record),
        token,
      };
      return response;
    },
    {
      body: arktype({
        name: "string",
        projectId: "string.uuid",
        appId: "string.uuid",
        environmentId: "string.uuid",
        expiresAt: "string?",
      }),
    },
  )
  .get(
    "/",
    async ({ query }) => {
      const { data, pagination } = await sourceMapTokenDAO.list({
        projectId: query.projectId,
        environmentId: query.environmentId,
        page: query.page,
        limit: query.limit,
      });

      return { data: data.map(toTokenResponse), pagination };
    },
    {
      query: arktype({
        projectId: "string.uuid?",
        environmentId: "string.uuid?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      const token = await sourceMapTokenDAO.findByIdOrThrow(id);
      return toTokenResponse(token);
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  // Rotation invalidates the previous raw token immediately.
  .post(
    "/:id/rotate",
    async ({ params: { id } }) => {
      await sourceMapTokenDAO.findByIdOrThrow(id);

      const rotated = await sourceMapTokenDAO.rotate(id);
      if (!rotated) {
        throw notFound("Upload token", id);
      }

      const response: SourceMapTokenWithSecret = {
        ...toTokenResponse(rotated.record),
        token: rotated.token,
      };
      return response;
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  // Soft revoke: keeps the audit trail, invalidates the token.
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await sourceMapTokenDAO.findByIdOrThrow(id);
      await sourceMapTokenDAO.revoke(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  );
