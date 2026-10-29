import { Elysia, status } from "elysia";
import { type as arktype } from "arktype";
import {
  badRequest,
  forbidden,
  notFound,
  payloadTooLarge,
  unauthorized,
} from "backend/errors";
import { resolveIdentity, validateUploadAuth } from "../auth";
import { projectDAO } from "db/dao/projects";
import { releaseDAO } from "db/dao/releases";
import { sourceMapDAO } from "db/dao/source-maps";
import { sourceMapTokenDAO } from "db/dao/source-maps/tokens";
import { appDAO } from "db/dao/apps";
import {
  findSourceMapFor,
  invalidateSourceMapCache,
  originalPositionFor,
  parseMapCached,
} from "./resolver";
import { MAX_UPLOAD_BYTES, readSourceMapUpload } from "./upload";

// ── upload-token surface: the Sentry-compatible CLI (`/api/0/...`) ──
export const sourceMapUploadRoutes = new Elysia({
  prefix: "api/0/projects",
})
  // Upload-token auth is a middleware concern: it resolves the token and its
  // project once and hands them to every upload handler.
  .resolve(async ({ request, params }) => {
    const auth = await validateUploadAuth(request);
    if (!auth.valid || !auth.token) {
      throw unauthorized("Unauthorized - Invalid upload token");
    }
    const project = await projectDAO.findByIdOrThrow(auth.token.projectId);
    if (project.id !== auth.token.projectId) {
      throw forbidden("Upload token is not valid for this project");
    }
    return { uploadToken: auth.token, uploadProject: project };
  })
  .post(
    "/:org/:project/releases/",
    async ({ request, uploadToken, uploadProject }) => {
      const contentType = request.headers.get("content-type") ?? "";
      const body: Record<string, string> = contentType.includes(
        "application/json",
      )
        ? ((await request.json().catch(() => ({}))) as Record<string, string>)
        : contentType.includes("form")
          ? Object.fromEntries(
              [...(await request.formData()).entries()].filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              ),
            )
          : {};
      const version = body.version ?? body.name;
      if (!version) throw badRequest("Release version is required");
      const release = await releaseDAO.findOrCreate({
        appId: uploadToken.appId,
        version,
      });
      return {
        version: release.version,
        dateCreated: release.updatedAt,
        projectId: uploadProject.id,
      };
    },
    {
      params: arktype({ org: "string", project: "string" }),
    },
  )
  .post(
    "/:org/:project/releases/:version/files/",
    async ({ request, params: { version }, uploadToken, uploadProject }) => {
      const declared = Number(request.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
        throw payloadTooLarge("Source map exceeds the 10 MB limit");
      }
      const upload = await readSourceMapUpload(await request.formData());
      const [, artifactRow] = await Promise.all([
        releaseDAO.findOrCreate({
          appId: uploadToken.appId,
          version,
        }),
        sourceMapDAO.create({
          appId: uploadToken.appId,
          release: version,
          dist: upload.dist,
          filename: upload.filename,
          mapJson: upload.mapJson,
        }),
      ]);
      const { updatedAt, ...artifact } = artifactRow;
      invalidateSourceMapCache(artifactRow.id);
      return status(201, { ...artifact, dateCreated: updatedAt });
    },
    {
      params: arktype({
        org: "string",
        project: "string",
        version: "string",
      }),
    },
  )
  .get(
    "/:org/:project/releases/:version/files/",
    async ({ params: { version }, query, uploadToken, uploadProject }) => {
      const data = await sourceMapDAO.list(
        { appId: uploadToken.appId as string },
        { cursor: query.cursor, limit: query.limit },
      );
      return {
        data: data.map(({ updatedAt, ...artifact }) => ({
          ...artifact,
          dateCreated: updatedAt,
        })),
      };
    },
    {
      params: arktype({
        org: "string",
        project: "string",
        version: "string",
      }),
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .delete(
    "/:org/:project/releases/:version/files/:fileId/",
    async ({ params: { version, fileId }, uploadToken, uploadProject }) => {
      await sourceMapDAO.deleteScoped(fileId, {
        projectId: uploadProject.id,
        release: version,
        appId: uploadToken.appId,
      });
      return { success: true };
    },
    {
      params: arktype({
        org: "string",
        project: "string",
        version: "string",
        fileId: "string",
      }),
    },
  )
  .post(
    "/:org/:project/releases/:version/",
    async ({ params: { version }, uploadToken }) => {
      const release = await releaseDAO.findByAppAndVersionOrThrow(
        uploadToken.appId,
        version,
      );
      const finalized = await releaseDAO.updateOrThrow(release.id, {});
      return {
        version: finalized.version,
      };
    },
    {
      params: arktype({
        org: "string",
        project: "string",
        version: "string",
      }),
    },
  );

// ── oidc surface: the admin reads and writes ─────────────
export const sourceMapRoutes = new Elysia({ prefix: "/source-maps" })
  .get("/", ({ query }) => sourceMapDAO.list({ appId: query.appId }, query), {
    query: arktype({
      appId: "string.uuid?",
      cursor: "string?",
      limit: "string.integer.parse?",
    }),
  });

// ── oidc surface: the admin reads and writes ─────────────
export const sourceMapTokenRoutes = new Elysia({
  prefix: "/source-map-tokens",
})
  .resolve(resolveIdentity)
  .post(
    "/",
    async ({ body }) => {
      const [, app] = await Promise.all([
        projectDAO.findByIdOrThrow(body.projectId),
        appDAO.findByIdOrThrow(body.appId),
      ]);
      if (app.projectId !== body.projectId)
        throw badRequest("App does not belong to this project");
      const { token, record } = await sourceMapTokenDAO.create({
        ...body,
        createdBy: "system",
        expiresAt: body.expiresAt ?? null,
      });
      return { ...record, token };
    },
    {
      body: arktype({
        name: "string",
        projectId: "string.uuid",
        appId: "string.uuid",
        expiresAt: "string?",
      }),
    },
  )
  .get("/", ({ query }) => sourceMapTokenDAO.list({ ...query }), {
    query: arktype({
      projectId: "string.uuid?",
      cursor: "string?",
      limit: "string.integer.parse?",
    }),
  })
  .get("/:id", ({ params: { id } }) => sourceMapTokenDAO.findByIdOrThrow(id), {
    params: arktype({ id: "string.uuid" }),
  })
  .post(
    "/:id/rotate",
    async ({ params: { id } }) => sourceMapTokenDAO.rotate(id),
    { params: arktype({ id: "string.uuid" }) },
  )
  .delete("/:id", ({ params: { id } }) => sourceMapTokenDAO.delete(id), {
    params: arktype({ id: "string.uuid" }),
  });
