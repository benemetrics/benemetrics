import { Elysia, status } from "elysia";
import { type as arktype } from "arktype";
import { badRequest, forbidden, notFound, payloadTooLarge, unauthorized } from "backend/errors";
import { validateUploadAuth } from "../../auth";
import { projectDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { releaseDAO } from "db/dao/releases";
import { sourceMapDAO } from "db/dao/source-maps";
import type { SourceMap } from "db/schema/source-maps";
import { toArtifactBase } from "../../source-maps/serialization";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Auth: the per-project/per-environment upload token (hashed
// in the DB), sent as the SENTRY_AUTH_TOKEN bearer.
async function authenticateUpload(
  request: Request,
  projectSlug: string,
) {
  const auth = await validateUploadAuth(request);
  if (!auth.valid || !auth.token) {
    throw unauthorized("Unauthorized - Invalid upload token");
  }

  const project = await projectDAO.findBySlug(projectSlug);
  if (!project) {
    throw notFound("Project", projectSlug);
  }
  if (project.id !== auth.token.projectId) {
    throw forbidden("Upload token is not valid for this project");
  }

  const environment = await environmentDAO.findById(
    auth.token.environmentId,
  );
  if (!environment) {
    throw forbidden("Upload token references a missing environment");
  }

  return { token: auth.token, project, environment };
}

async function readFormLikeBody(
  request: Request,
): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return (await request.json()) as Record<string, string>;
    } catch {
      return {};
    }
  }
  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  return {};
}

function toSentryRelease(release: {
  version: string;
  ref: string | null;
  url: string | null;
  owner: string | null;
  status: string;
  createdAt: string;
}) {
  return {
    version: release.version,
    ref: release.ref,
    url: release.url,
    owner: release.owner,
    status: release.status,
    dateCreated: release.createdAt,
  };
}

export const sourceMapUploadRoutes = new Elysia({
  prefix: "api/0/projects",
})
  // sentry-cli: `releases new <version>`
  .post(
    "/:org/:project/releases/",
    async ({ request, params: { org, project: projectSlug } }) => {
      const { token, project, environment } = await authenticateUpload(
        request,
        projectSlug,
      );

      const body = await readFormLikeBody(request);
      const version = body.version ?? body.name;
      if (!version) {
        throw badRequest("Release version is required");
      }

      const release = await releaseDAO.findOrCreate({
        appId: token.appId,
        version,
        ref: body.ref ?? null,
        url: body.url ?? null,
        owner: body.owner ?? null,
        status: "draft",
      });

      return { ...toSentryRelease(release), projectId: project.id };
    },
    {
      params: arktype({ org: "string", project: "string" }),
    },
  )
  // sentry-cli: `releases files <version> upload-sourcemaps ./dist`
  // Multipart: file (the .map), name (--url-prefix path), dist
  .post(
    "/:org/:project/releases/:version/files/",
    async ({ request, params: { org, project: projectSlug, version } }) => {
      const { token, project, environment } = await authenticateUpload(
        request,
        projectSlug,
      );

      // Tolerate uploads without a prior "releases new".
      const release = await releaseDAO.findOrCreate({
        appId: token.appId,
        version,
        status: "draft",
      });

      const form = await request.formData();
      const file = form.get("file");
      const name = form.get("name");
      const dist = form.get("dist");

      if (
        !file ||
        typeof file === "string" ||
        !name ||
        typeof name !== "string"
      ) {
        throw badRequest("Multipart upload requires 'file' and 'name' fields");
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        throw payloadTooLarge("Source map exceeds the 10 MB limit");
      }

      const mapJson = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(mapJson);
      } catch {
        throw badRequest("Uploaded file is not valid JSON");
      }
      const map = parsed as {
        version?: unknown;
        sources?: unknown;
        mappings?: unknown;
      };
      if (
        map.version !== 3 ||
        !Array.isArray(map.sources) ||
        typeof map.mappings !== "string"
      ) {
        throw badRequest("Invalid source map: expected version 3 with sources and mappings");
      }

      const created = await sourceMapDAO.create({
        projectId: project.id,
        appId: token.appId,
        environmentId: environment.id,
        release: version,
        dist: typeof dist === "string" ? dist : null,
        filename: name,
        mapJson,
      });

      return status(201, { ...toArtifactBase(created), dateCreated: created.createdAt });
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
    async ({ request, params: { org, project: projectSlug, version }, query }) => {
      const { project } = await authenticateUpload(request, projectSlug);

      const { data, pagination } = await sourceMapDAO.list({
        projectId: project.id,
        release: version,
        page: query.page,
        limit: query.limit,
      });

      return {
        data: data.map((map: SourceMap) => ({ ...toArtifactBase(map), dateCreated: map.createdAt })),
        pagination,
      };
    },
    {
      params: arktype({
        org: "string",
        project: "string",
        version: "string",
      }),
      query: arktype({
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .delete(
    "/:org/:project/releases/:version/files/:fileId/",
    async ({ request, params: { org, project: projectSlug, version, fileId } }) => {
      const { project } = await authenticateUpload(request, projectSlug);

      const map = await sourceMapDAO.findByIdOrThrow(fileId);
      if (map.projectId !== project.id || map.release !== version) {
        throw notFound("Source map");
      }

      await sourceMapDAO.delete(map.id);
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
  // sentry-cli: `releases finalize <version>`
  .post(
    "/:org/:project/releases/:version/",
    async ({ request, params: { org, project: projectSlug, version } }) => {
      const { token } = await authenticateUpload(
        request,
        projectSlug,
      );

      const release = await releaseDAO.findByAppAndVersionOrThrow(
        token.appId,
        version,
      );

      const finalized = await releaseDAO.updateOrThrow(release.id, {
        status: "finalized",
      });
      return toSentryRelease(finalized);
    },
    {
      params: arktype({
        org: "string",
        project: "string",
        version: "string",
      }),
    },
  );
