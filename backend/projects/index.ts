import { Elysia } from "elysia";
import { badRequest, notFound } from "backend/errors";
import { type as arktype } from "arktype";
import { projectDAO, appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { resolveAdminId } from "../auth";
import { scopedViewFor } from "../permissions/engine";
import { issueDAO } from "db/dao/issues";

// ── oidc surface: the admin reads and writes ─────────────
export const projectRoutes = new Elysia({ prefix: "/api/admin/projects" })
  .resolve(resolveAdminId)
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
        name: body.name,
        slug,
        description: body.description || "",
      });
      try {
        await environmentDAO.create({
          projectId: project.id,
          name: "Testing",
          slug: "testing",
          isDefault: 1,
        });
      } catch (err) {
        // A project without its default environment breaks the invariant.
        await projectDAO.delete(project.id);
        throw err;
      }
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
    async ({ query, request, isAdmin, adminScope }) => {
      const view = await scopedViewFor({ request, isAdmin, adminScope });
      return projectDAO.list({
        cursor: query.cursor,
        limit: query.limit,
        ...(view ? { projectIds: [...view.projectIds] } : {}),
      });
    },
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id }, request, isAdmin, adminScope }) => {
      const view = await scopedViewFor({ request, isAdmin, adminScope });
      if (view && !view.projectIds.has(id)) throw notFound("Project", id);
      const project = await projectDAO.findByIdOrThrow(id);
      const { data: apps } = await appDAO.listByProject(id, {
        limit: 100,
        ...(view ? { appIds: [...view.appIds] } : {}),
      });
      return { ...project, apps };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      const apps = await appDAO.listRawByProject(id);
      await Promise.all(
        apps.map(async (app) => {
          await issueDAO.deleteByApp(app.id);
          await appDAO.delete(app.id);
        }),
      );
      await environmentDAO.deleteByProject(id);
      await projectDAO.delete(id);
      return { success: true };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .post(
    "/:id/duplicate",
    async ({ params: { id }, body }) => {
      const { project, apps } = await projectDAO.duplicate(id, body);
      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        appCount: apps.length,
        createdAt: project.createdAt,
        // Response shaping stays out of the DAO: each copied app carries
        // its environment, and the admin middleware appends the DSN.
        apps: apps.map(({ app, environment }) => ({ ...app, environment })),
      };
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        name: "string?",
        slug: "string?",
        description: "string?",
      }),
    },
  )
  .group("/:id/apps", (apps) =>
    apps
      .get(
        "",
        async ({ params: { id }, query }) => {
          await projectDAO.findByIdOrThrow(id);
          return appDAO.listByProject(id, { cursor: query.cursor, limit: query.limit });
        },
        {
          params: arktype({ id: "string.uuid" }),
          query: arktype({
            cursor: "string?",
            limit: "string.integer.parse?",
          }),
        },
      )
      .post(
        "",
        async ({ params: { id }, body }) => {
          const project = await projectDAO.findByIdOrThrow(id);
          const environment = await environmentDAO.resolveForApp(id, body.environment);
          const app = await appDAO.create({
            id: crypto.randomUUID(),
            projectId: id,
            environmentId: environment.id,
            name: body.name,
            platform: body.platform || "javascript",
            ingestKey: `${project.slug}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
            publicKey: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          });
          return { ...app, environment };
        },
        {
          params: arktype({ id: "string.uuid" }),
          body: arktype({
            name: "string",
            platform: "string?",
            environment: "string?",
          }),
        },
      ),
  );
