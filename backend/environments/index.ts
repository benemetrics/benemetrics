import { Elysia } from "elysia";
import { badRequest, notFound } from "backend/errors";
import { type as arktype } from "arktype";
import { projectDAO, appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { resolveAdminId } from "../auth";
import { scopedViewFor } from "../permissions/engine";
import { issueDAO } from "db/dao/issues";

const trimmedSlug = arktype("string.trim").to("string >= 1");

// ── oidc surface: the admin reads and writes ─────────────
export const environmentRoutes = new Elysia({ prefix: "/api/admin/environments" })
  .resolve(resolveAdminId)
  .post(
    "/",
    async ({ body }) => {
      const project = await projectDAO.findByIdOrThrow(body.projectId);
      const slug = body.slug || body.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) throw badRequest("Environment slug could not be derived");
      const total = await environmentDAO.countByProject(project.id);
      const makeDefault = body.isDefault === true || total === 0;
      // Insert before demoting: a slug conflict must not drop the default.
      const created = await environmentDAO.create({ projectId: project.id, name: body.name, slug, isDefault: 0 });
      if (makeDefault) {
        await environmentDAO.clearDefault(project.id);
        await environmentDAO.markDefault(created.id);
      }
      await environmentDAO.ensureDefault(project.id);
      return environmentDAO.findByIdOrThrow(created.id);
    },
    {
      body: arktype({
        projectId: "string.uuid",
        name: "string",
        slug: "string?",
        isDefault: "boolean?",
      }),
    },
  )
  .get(
    "/",
    // The filter belongs in the query: an unknown project yields an empty
    // list, not a lookup and a 404.
    async ({ query, request, isAdmin, adminScope }) => {
      const view = await scopedViewFor({ request, isAdmin, adminScope });
      return environmentDAO.list({
        projectId: query.projectId,
        cursor: query.cursor,
        limit: query.limit,
        ...(view ? { environmentIds: [...view.environmentIds] } : {}),
      });
    },
    {
      query: arktype({
        projectId: "string.uuid?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id }, request, isAdmin, adminScope }) => {
      const view = await scopedViewFor({ request, isAdmin, adminScope });
      if (view && !view.environmentIds.has(id)) throw notFound("Environment", id);
      return environmentDAO.findByIdOrThrow(id);
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => {
      const current = await environmentDAO.findByIdOrThrow(id);
      const targetDefault = body.isDefault ?? current.isDefault;
      const fields = { name: body.name ?? current.name, slug: body.slug ?? current.slug };
      if (targetDefault && !current.isDefault) {
        // Update the fields before demoting, so a slug conflict cannot drop the default.
        await environmentDAO.updateOrThrow(id, { ...fields, isDefault: 0 });
        await environmentDAO.clearDefault(current.projectId, id);
        await environmentDAO.markDefault(id);
      } else {
        await environmentDAO.updateOrThrow(id, { ...fields, isDefault: targetDefault ? 1 : 0 });
      }
      await environmentDAO.ensureDefault(current.projectId);
      return environmentDAO.findByIdOrThrow(id);
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        name: "string?",
        "slug?": trimmedSlug,
        isDefault: "boolean?",
      }),
    },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      const environment = await environmentDAO.findById(id);
      if (!environment) return { success: true, deletedApps: 0 };
      const apps = await appDAO.listByEnvironment(id);
      await Promise.all(apps.map(async (app) => { await issueDAO.deleteByApp(app.id); await appDAO.delete(app.id); }));
      await environmentDAO.delete(id);
      await environmentDAO.ensureDefault(environment.projectId);
      return { success: true, deletedApps: apps.length };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  );
