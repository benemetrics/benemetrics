import { Elysia } from "elysia";
import { badRequest } from "backend/errors";
import { type as arktype } from "arktype";
import { projectDAO, appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { deleteAppCascade } from "../apps";
import type { Environment } from "db/schema/environments";

// Business rule: a project owns many environments shared by
// all of its apps, and exactly one of them is the default.
// Slugs are unique within a project.
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const trimmedSlug = arktype("string.trim").to("string >= 1");

export function toEnvironmentResponse(environment: Environment) {
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    slug: environment.slug,
    isDefault: environment.isDefault === 1,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt,
  };
}

export const environmentRoutes = new Elysia({ prefix: "environments" })
  .post(
    "/",
    async ({ body }) => {
      await projectDAO.findByIdOrThrow(body.projectId);

      const slug = body.slug || deriveSlug(body.name);
      if (!slug) throw badRequest("Environment slug could not be derived");

      // The first environment of a project is always the default.
      const { pagination } = await environmentDAO.list({
        projectId: body.projectId,
        page: 1,
        limit: 1,
      });
      const makeDefault = body.isDefault === true || pagination.total === 0;
      if (makeDefault) await environmentDAO.clearDefault(body.projectId);

      const environment = await environmentDAO.create({
        projectId: body.projectId,
        name: body.name,
        slug,
        isDefault: makeDefault ? 1 : 0,
      });

      await environmentDAO.ensureDefault(body.projectId);
      return toEnvironmentResponse(environment);
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
    async ({ query }) => {
      await projectDAO.findByIdOrThrow(query.projectId);

      const { data, pagination } = await environmentDAO.list({
        projectId: query.projectId,
        page: query.page,
        limit: query.limit,
      });

      return { data: data.map(toEnvironmentResponse), pagination };
    },
    {
      query: arktype({
        projectId: "string.uuid",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      const environment = await environmentDAO.findByIdOrThrow(id);
      return toEnvironmentResponse(environment);
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => {
      const environment = await environmentDAO.findByIdOrThrow(id);

      const slug = body.slug;
      if (body.isDefault === true) await environmentDAO.clearDefault(environment.projectId, id);

      const updated = await environmentDAO.updateOrThrow(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault ? 1 : 0 } : {}),
      });

      await environmentDAO.ensureDefault(environment.projectId);
      return toEnvironmentResponse(updated);
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
      const environment = await environmentDAO.findByIdOrThrow(id);

      // Business rule: deleting an environment cascades to the apps
      // created inside it (and everything scoped to those apps).
      // Environments are shared, so apps in other environments and the
      // rest of the project are untouched.
      const apps = await appDAO.listByEnvironment(id);
      for (const app of apps) await deleteAppCascade(app.id);

      await environmentDAO.delete(id);
      await environmentDAO.ensureDefault(environment.projectId);

      return { success: true, deletedApps: apps.length };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  );
