import { Elysia } from "elysia";
import { badRequest, notFound } from "backend/errors";
import { type as arktype } from "arktype";
import { sourceMapDAO } from "db/dao/source-maps";
import {
  findSourceMapFor,
  originalPositionFor,
  parseMapCached,
} from "../../source-maps/resolver";
import { toArtifactResponse } from "../../source-maps/serialization";
import type {
  SourceMapResolveResponse,
} from "../../protocol/source-map";

// Map content (mapJson / sourcesContent) is never
// exposed unless explicitly requested via ?include=content.
export const sourceMapRoutes = new Elysia({ prefix: "source-maps" })
  .get(
    "/",
    async ({ query }) => {
      const { data, pagination } = await sourceMapDAO.list({
        projectId: query.projectId,
        environmentId: query.environmentId,
        release: query.release,
        page: query.page,
        limit: query.limit,
      });

      return { data: data.map(toArtifactResponse), pagination };
    },
    {
      query: arktype({
        projectId: "string.uuid?",
        environmentId: "string.uuid?",
        release: "string?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id }, query: { include } }) => {
      const map = await sourceMapDAO.findByIdOrThrow(id);
      return include === "content"
        ? { ...toArtifactResponse(map), mapJson: map.mapJson }
        : toArtifactResponse(map);
    },
    {
      params: arktype({ id: "string.uuid" }),
      query: arktype({ include: "'content'?" }),
    },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await sourceMapDAO.findByIdOrThrow(id);
      await sourceMapDAO.delete(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/resolve",
    async ({ body }) => {
      const map = await findSourceMapFor(
        body.projectId,
        body.release,
        body.filename,
      );
      if (!map) {
        throw notFound("Source map", `${body.filename} in release ${body.release}`);
      }

      let original: SourceMapResolveResponse["original"] = null;
      try {
        original = originalPositionFor(
          parseMapCached(map.id, map.mapJson),
          body.line,
          body.column,
        );
      } catch (e) {
        throw badRequest(`Failed to decode source map: ${e instanceof Error ? e.message : String(e)}`);
      }

      const response: SourceMapResolveResponse = {
        filename: body.filename,
        release: body.release,
        line: body.line,
        column: body.column,
        original,
      };
      return response;
    },
    {
      body: arktype({
        projectId: "string.uuid",
        release: "string",
        filename: "string",
        line: "number",
        column: "number",
      }),
    },
  );
