import { Elysia } from "elysia";
import { type } from "arktype";
import { sourceMapDAO } from "../../db/dao/source-maps.ts";
import { findSourceMapFor, originalPositionFor, parseMapCached } from "./resolver.ts";
import { toArtifactResponse } from "./serialization.ts";
import type { SourceMapResolveResponse } from "../protocol/source-map.ts";

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
      query: type({
        projectId: "string.uuid?",
        environmentId: "string.uuid?",
        release: "string?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    }
  )
  .get(
    "/:id",
    async ({ params: { id }, query: { include } }) => {
      const map = await sourceMapDAO.findByIdOrThrow(id);
      return include === "content"
        ? { ...toArtifactResponse(map), mapJson: map.mapJson }
        : toArtifactResponse(map);
    },
    { params: type({ id: "string.uuid" }), query: type({ include: "'content'?" }) }
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await sourceMapDAO.findByIdOrThrow(id);
      await sourceMapDAO.delete(id);
      return { success: true };
    },
    { params: type({ id: "string.uuid" }) }
  )
  .post(
    "/resolve",
    async ({ body }) => {
      const map = await findSourceMapFor(body.projectId, body.release, body.filename);
      if (!map) throw new Error(`Source map not found: ${body.filename} in release ${body.release}`);

      let original: SourceMapResolveResponse["original"] = null;
      try {
        original = originalPositionFor(parseMapCached(map.id, map.mapJson), body.line, body.column);
      } catch (e) {
        throw new Error(`Failed to decode source map: ${e instanceof Error ? e.message : String(e)}`);
      }

      return { filename: body.filename, release: body.release, line: body.line, column: body.column, original };
    },
    {
      body: type({ projectId: "string.uuid", release: "string", filename: "string", line: "number", column: "number" }),
    }
  );