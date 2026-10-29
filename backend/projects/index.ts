import { Elysia } from "elysia";
import { badRequest, notFound } from "backend/errors";
import { type as arktype } from "arktype";
import { projectDAO } from "db/dao/project";
import { resolveIdentity } from "../auth";
import { projectsAndAppsPermissions } from "../permissions/engine";
import { appDAO } from "db/dao/app";

// ── oidc surface: the admin reads and writes ─────────────
export const projectRoutes = new Elysia({ prefix: "/api/admin/projects" })
  .resolve(resolveIdentity)
  .resolve(projectsAndAppsPermissions)
  .post(
    "/",
    async ({ body }) => {
      const slug = (body.slug || body.name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) throw badRequest("Project slug could not be derived");
      const project = await projectDAO.createUnique({
        ...body,
        slug,
        description: body.description || "",
      });
      return { ...project, appCount: 0 };
    },
    {
      body: arktype({
        name: "string",
        slug: "string?",
        description: "string?",
      }),
    },
  )
  .get(
    "/",
    async ({ query, perms: { projectIds } }) => {
      return projectDAO.list(
        {
          cursor: query.cursor,
          limit: query.limit,
        },
        { ...(projectIds.length && { projectIds }) },
      );
    },
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .group("/:id", { params: arktype({ id: "string.uuid" }) }, (project) =>
    project
      .get("/", async ({ params: { id }, perms: { projectIds } }) => {
        if (!projectIds.includes(id)) throw notFound("Project", id);
        return projectDAO.findByIdOrThrow(id);
      })
      .delete("/", async ({ params: { id } }) => projectDAO.delete(id))
      .post(
        "/duplicate",
        async ({ params: { id }, body }) => {
          const { project, apps } = await projectDAO.duplicate(id, body);
          return { ...project, apps };
        },
        {
          body: arktype({
            name: "string?",
            slug: "string?",
            description: "string?",
          }),
        },
      )
      .group("/apps", (apps) =>
        apps
          .get(
            "",
            async ({ params: { id }, perms: { appIds }, query }) =>
              appDAO.listByProject(id, {
                ...query,
                ...(appIds.length && { appIds }),
              }),
            {
              query: arktype({
                cursor: "string?",
                limit: "string.integer.parse?",
              }),
            },
          )
          .post(
            "",
            async ({ params: { id }, body }) =>
              appDAO.create({
                ...body,
                projectId: id,
                publicKey: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
              }),
            {
              body: arktype({
                name: "string",
                platform: "string",
              }),
            },
          ),
      ),
  );
