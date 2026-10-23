import { Elysia, status } from "elysia";
import { type as arktype } from "arktype";
import {
  badRequest,
  forbidden,
  notFound,
  payloadTooLarge,
  unauthorized,
} from "backend/errors";
import { resolveAdminId, validateUploadAuth } from "../auth";
import { projectDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { releaseDAO } from "db/dao/releases";
import { sourceMapDAO } from "db/dao/source-maps";
import { sourceMapTokenDAO } from "db/dao/source-map-tokens";
import { appDAO } from "db/dao/project";
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
  // Upload-token auth is a middleware concern: it resolves the token, its
  // project and environment once and hands them to every upload handler.
  .resolve(async ({ request, params }) => {
    const auth = await validateUploadAuth(request);
    if (!auth.valid || !auth.token) {
      throw unauthorized("Unauthorized - Invalid upload token");
    }
    const projectSlug = String((params as { project?: string }).project ?? "");
    const [project, environment] = await Promise.all([
      projectDAO.findBySlug(projectSlug),
      environmentDAO.findById(auth.token.environmentId),
    ]);
    if (!project) throw notFound("Project", projectSlug);
    if (project.id !== auth.token.projectId) {
      throw forbidden("Upload token is not valid for this project");
    }
    if (!environment) {
      throw forbidden("Upload token references a missing environment");
    }
    if (environment.projectId !== project.id) {
      throw forbidden("Upload token environment does not belong to this project");
    }
    return { uploadToken: auth.token, uploadProject: project, uploadEnvironment: environment };
  })
  .post(
    "/:org/:project/releases/",
    async ({ request, uploadToken, uploadProject }) => {
      const contentType = request.headers.get("content-type") ?? "";
      const body: Record<string, string> = contentType.includes("application/json") ? await request.json().catch(() => ({})) as Record<string, string> : contentType.includes("form") ? Object.fromEntries([...(await request.formData()).entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
      const version = body.version ?? body.name;
      if (!version) throw badRequest("Release version is required");
      const release = await releaseDAO.findOrCreate({ appId: uploadToken.appId, version, ref: body.ref ?? null, url: body.url ?? null, owner: body.owner ?? null, status: "draft" });
      return { version: release.version, ref: release.ref, url: release.url, owner: release.owner, status: release.status, dateCreated: release.createdAt, projectId: uploadProject.id };
    },
    {
      params: arktype({ org: "string", project: "string" }),
    },
  )
  .post(
    "/:org/:project/releases/:version/files/",
    async ({ request, params: { version }, uploadToken, uploadProject, uploadEnvironment }) => {
      const declared = Number(request.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
        throw payloadTooLarge("Source map exceeds the 10 MB limit");
      }
      const upload = await readSourceMapUpload(await request.formData());
      const [, artifactRow] = await Promise.all([
        releaseDAO.findOrCreate({ appId: uploadToken.appId, version, status: "draft" }),
        sourceMapDAO.create({ projectId: uploadProject.id, appId: uploadToken.appId, environmentId: uploadEnvironment.id, release: version, dist: upload.dist, filename: upload.filename, mapJson: upload.mapJson }),
      ]);
      const { createdAt, ...artifact } = artifactRow;
      invalidateSourceMapCache(artifactRow.id);
      return status(201, { ...artifact, dateCreated: createdAt });
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
      const { data } = await sourceMapDAO.list({ projectId: uploadProject.id, appId: uploadToken.appId, environmentId: uploadToken.environmentId, release: version, cursor: query.cursor, limit: query.limit });
      return { data: data.map(({ createdAt, ...artifact }) => ({ ...artifact, dateCreated: createdAt })) };
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
      const release = await releaseDAO.findByAppAndVersionOrThrow(uploadToken.appId, version);
      const finalized = await releaseDAO.updateOrThrow(release.id, { status: "finalized" });
      return { version: finalized.version, ref: finalized.ref, url: finalized.url, owner: finalized.owner, status: finalized.status, dateCreated: finalized.createdAt };
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
export const sourceMapRoutes = new Elysia({ prefix: "/api/admin/source-maps" })
  .resolve(resolveAdminId)
  .get(
    "/",
    async ({ query }) => {
      return sourceMapDAO.list({
        projectId: query.projectId,
        environmentId: query.environmentId,
        release: query.release,
        cursor: query.cursor,
        limit: query.limit,
      });
    },
    {
      query: arktype({
        projectId: "string.uuid?",
        environmentId: "string.uuid?",
        release: "string?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id }, query: { include } }) => {
      return include === "content"
        ? sourceMapDAO.findWithContentOrThrow(id)
        : sourceMapDAO.findByIdOrThrow(id);
    },
    {
      params: arktype({ id: "string.uuid" }),
      query: arktype({ include: "'content'?" }),
    },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await sourceMapDAO.delete(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/resolve",
    async ({ body }) => {
      const map = await findSourceMapFor(body.projectId, body.release, body.filename);
      if (!map) throw notFound("Source map", `${body.filename} in release ${body.release}`);
      try {
        const original = originalPositionFor(parseMapCached(map), body.line, body.column);
        return { filename: body.filename, release: body.release, line: body.line, column: body.column, original };
      } catch (e) {
        throw badRequest(`Failed to decode source map: ${e instanceof Error ? e.message : String(e)}`);
      }
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

// ── oidc surface: the admin reads and writes ─────────────
export const sourceMapTokenRoutes = new Elysia({ prefix: "/api/admin/source-map-tokens" })
  .resolve(resolveAdminId)
  .post(
    "/",
    async ({ body, adminId }) => {
      const [, environment, app] = await Promise.all([
        projectDAO.findByIdOrThrow(body.projectId),
        environmentDAO.findByIdOrThrow(body.environmentId),
        appDAO.findByIdOrThrow(body.appId),
      ]);
      if (environment.projectId !== body.projectId) throw badRequest("Environment does not belong to this project");
      if (app.projectId !== body.projectId) throw badRequest("App does not belong to this project");
      const { token, record } = await sourceMapTokenDAO.create({ ...body, createdBy: adminId, expiresAt: body.expiresAt ?? null });
      return { ...record, token };
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
      return sourceMapTokenDAO.list({ ...query });
    },
    {
      query: arktype({
        projectId: "string.uuid?",
        environmentId: "string.uuid?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) => sourceMapTokenDAO.findByIdOrThrow(id),
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/:id/rotate",
    async ({ params: { id } }) => {
      await sourceMapTokenDAO.findByIdOrThrow(id);
      const rotated = await sourceMapTokenDAO.rotate(id);
      if (!rotated) throw notFound("Upload token", id);
      return { ...rotated.record, token: rotated.token };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await sourceMapTokenDAO.revoke(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  );
