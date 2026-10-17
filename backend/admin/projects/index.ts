import { Elysia } from "elysia";
import { ApiError, ErrorCode, badRequest, internalError } from "backend/errors";
import { type as arktype } from "arktype";
import { projectDAO, appDAO, toAppResponse } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { deriveSlug, toEnvironmentResponse } from "../environments";
import { deleteAppCascade } from "../apps";
import { requestHost } from "../../host";
import { storedEventDAO } from "db/dao/stored-event";
import type { Environment } from "db/schema/environments";
import type { AppRecord } from "db/schema/project";

function randomKey(length: number): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

async function createProjectWithUniqueSlug(input: {
  name: string;
  slug: string;
  description: string | null;
}) {
  for (let suffix = 1; ; suffix += 1) {
    const slug = suffix === 1 ? input.slug : `${input.slug}-${suffix}`;
    try {
      return await projectDAO.create({ ...input, slug });
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== ErrorCode.CONFLICT) {
        throw err;
      }
    }
  }
}

// Resolves the environment an app is created inside of.
// An explicit name/slug reuses an existing project environment
// when one matches; otherwise a new one is created. With no
// preference the project's default environment is used (the
// "testing" one created with the project).
async function resolveEnvironmentForApp(
  projectId: string,
  environmentName?: string,
) {
  if (!environmentName) {
    const defaultEnvironment = await environmentDAO.findDefault(projectId);
    if (defaultEnvironment) return defaultEnvironment;

    return environmentDAO.findOrCreate({
      projectId,
      name: "Testing",
      slug: "testing",
      isDefault: 1,
    });
  }

  const slug = deriveSlug(environmentName);
  if (slug) {
    const existing = await environmentDAO.findByProjectAndSlug(projectId, slug);
    if (existing) return existing;
  }

  const byName = await environmentDAO.findByProjectAndName(projectId, environmentName);
  if (byName) return byName;

  const { pagination } = await environmentDAO.list({
    projectId,
    page: 1,
    limit: 1,
  });
  const makeDefault = pagination.total === 0;
  return environmentDAO.findOrCreate({
    projectId,
    name: environmentName,
    slug: slug || crypto.randomUUID(),
    isDefault: makeDefault ? 1 : 0,
  });
}

export const projectRoutes = new Elysia({ prefix: "projects" })
  .post(
    "/",
    async ({ body, request }) => {
      const slug = deriveSlug(body.slug || body.name);
      if (!slug) throw badRequest("Project slug could not be derived");

      const project = await projectDAO.create({
        name: body.name,
        slug,
        description: body.description || "",
      });

      // Every project starts with a default "testing"
      // environment. Apps are created later inside an
      // environment of the user's choosing.
      await environmentDAO.create({
        projectId: project.id,
        name: "Testing",
        slug: "testing",
        isDefault: 1,
      });

      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        appCount: 0,
        createdAt: project.createdAt,
      };
    },
    {
      body: arktype({
        name: "string",
        slug: "string?",
        description: "string?",
        host: "string?",
      }),
    },
  )
  .get(
    "/",
    async ({ query }) =>
      projectDAO.list({ page: query.page, limit: query.limit }),
    {
      query: arktype({
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id }, request }) => {
      const project = await projectDAO.findByIdOrThrow(id);
      const { data: apps } = await appDAO.listByProject(id, { limit: 100 });
      return {
        ...project,
        apps: apps.map((app) => toAppResponse(app, requestHost(request))),
      };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await projectDAO.findByIdOrThrow(id);

      const apps = await appDAO.listRawByProject(id);
      for (const app of apps) await deleteAppCascade(app.id);

      // Cascade to rows scoped to the project but not to a single app.
      await storedEventDAO.deleteByProject(id);
      // Environments are project-scoped and shared by the project's
      // apps, so they are removed with the project.
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
    async ({ params: { id }, body, request }) => {
      const source = await projectDAO.findByIdOrThrow(id);

      const name = body.name?.trim() || `${source.name} (copy)`;

      const baseSlug = deriveSlug(body.slug || name) || deriveSlug(source.name);
      // Slugs are globally unique, so a copy of "checkout" becomes
      // "checkout-copy", "checkout-copy-2", ...
      const project = await createProjectWithUniqueSlug({
        name,
        slug: baseSlug,
        description: body.description ?? source.description,
      });

      // Environments are project-scoped and shared by the
      // project's apps: copy them with fresh ids, keeping
      // names, slugs and the default flag. Slugs are only
      // unique within a project, so reusing them is safe.
      const sourceEnvironments = await environmentDAO.listAllByProject(id);
      const environmentIdMap = new Map<string, string>();
      const newEnvironments: Environment[] = [];
      for (const sourceEnvironment of sourceEnvironments) {
        const created = await environmentDAO.create({
          projectId: project.id,
          name: sourceEnvironment.name,
          slug: sourceEnvironment.slug,
          isDefault: sourceEnvironment.isDefault,
        });
        environmentIdMap.set(sourceEnvironment.id, created.id);
        newEnvironments.push(created);
      }
      if (newEnvironments.length === 0) {
        // Business rule: every project has exactly one
        // default environment.
        const created = await environmentDAO.create({
          projectId: project.id,
          name: "Testing",
          slug: "testing",
          isDefault: 1,
        });
        newEnvironments.push(created);
      } else if (!newEnvironments.some((e) => e.isDefault === 1)) {
        await environmentDAO.markDefault(newEnvironments[0]!.id);
      }
      const environmentById = new Map(newEnvironments.map((e) => [e.id, e]));

      const defaultEnvironmentId =
        newEnvironments.find((e) => e.isDefault === 1)?.id ?? newEnvironments[0]!.id;
      const sourceApps = await appDAO.listRawByProject(id);
      const duplicatedApps: { app: AppRecord; environment: Environment }[] = [];
      for (const sourceApp of sourceApps) {
        const environmentId =
          environmentIdMap.get(sourceApp.environmentId) ?? defaultEnvironmentId;
        const app = await appDAO.create({
          id: crypto.randomUUID(),
          projectId: project.id,
          environmentId,
          name: sourceApp.name,
          platform: sourceApp.platform,
          ingestKey: `${project.slug}-${randomKey(12)}`,
          publicKey: randomKey(32),
        });
        const environment = environmentById.get(environmentId);
        if (!environment) {
          throw internalError("Duplicated app has no environment");
        }
        duplicatedApps.push({ app, environment });
      }

      const host = requestHost(request);
      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        appCount: duplicatedApps.length,
        createdAt: project.createdAt,
        apps: duplicatedApps.map(({ app, environment }) => ({
          ...toAppResponse(app, host),
          environment: toEnvironmentResponse(environment),
        })),
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
        async ({ params: { id }, query, request }) => {
          await projectDAO.findByIdOrThrow(id);
          const { data, pagination } = await appDAO.listByProject(id, {
            page: query.page,
            limit: query.limit,
          });
          const host = requestHost(request);
          return { data: data.map((app) => toAppResponse(app, host)), pagination };
        },
        {
          params: arktype({ id: "string.uuid" }),
          query: arktype({
            page: "string.integer.parse?",
            limit: "string.integer.parse?",
          }),
        },
      )
      .post(
        "",
        async ({ params: { id }, body, request }) => {
          const project = await projectDAO.findByIdOrThrow(id);

          // App-environment combo: the user picks the project and
          // the environment, and the app is created inside it.
          const environment = await resolveEnvironmentForApp(id, body.environment);

          const app = await appDAO.create({
            id: crypto.randomUUID(),
            projectId: id,
            environmentId: environment.id,
            name: body.name,
            platform: body.platform || "javascript",
            ingestKey: `${project.slug}-${randomKey(12)}`,
            publicKey: randomKey(32),
          });

          return {
            ...toAppResponse(app, requestHost(request)),
            environment: toEnvironmentResponse(environment),
          };
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
