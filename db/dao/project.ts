import { db } from "db";
import { projects, apps, type Project, type ProjectInsert, type AppRecord } from "db/schema/project";
import { eq, and, desc, inArray, sql, count } from "drizzle-orm";
import { ApiError, ErrorCode, conflict, notFound } from "backend/errors";
import { cursorLimit } from "./cursor";

const projectFields = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

export const projectDAO = {
  create: async (data: Omit<ProjectInsert, "id"> & { id?: string }) => {
    const [created] = await db
      .insert(projects)
      .values({ ...data, id: data.id ?? crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .onConflictDoNothing({ target: projects.slug })
      .returning(projectFields);
    if (!created) {
      throw conflict(`Project slug already exists: ${data.slug}`);
    }
    return created;
  },

  createUnique: async (input: {
    name: string;
    slug: string;
    description?: string | null;
  }) => {
    for (let suffix = 1; ; suffix += 1) {
      try {
        return await projectDAO.create({
          name: input.name,
          slug: suffix === 1 ? input.slug : `${input.slug}-${suffix}`,
          description: input.description ?? "",
        });
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== ErrorCode.CONFLICT) {
          throw err;
        }
      }
    }
  },

  duplicate: async (
    sourceId: string,
    overrides: { name?: string; slug?: string; description?: string },
  ) => {
    const source = await projectDAO.findByIdOrThrow(sourceId);
    const name = overrides.name?.trim() || `${source.name} (copy)`;
    const project = await projectDAO.createUnique({
      name,
      slug:
        (overrides.slug || name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
        source.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      description: overrides.description ?? source.description,
    });

    const duplicatedApps = await Promise.all(
      (await appDAO.listRawByProject(sourceId)).map(
        async (sourceApp): Promise<AppRecord> => {
          return await appDAO.create({
            id: crypto.randomUUID(),
            projectId: project.id,
            name: sourceApp.name,
            platform: sourceApp.platform,
            ingestKey: `${project.slug}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
            publicKey: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          });
        },
      ),
    );

    return { project, apps: duplicatedApps };
  },

  findById: async (id: string): Promise<Project | undefined> =>
    (
      await db
        .select(projectFields)
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1)
    )[0],
  
  findByIdOrThrow: async (id: string) => {
    const project = await projectDAO.findById(id);
    if (!project) throw notFound("Project", id);
    return project;
  },

  list: async (options?: {
    cursor?: string;
    limit?: number;
    projectIds?: string[];
  }) => db
        .select({ ...projectFields, appCount: count(apps.id) })
        .from(projects)
        .where(and(options?.projectIds ? inArray(projects.id, options.projectIds) : undefined, options?.cursor ? gt(projects.id, options.cursor) : undefined))
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .rightJoin(apps, eq(apps.projectId, projects.id))
        .limit(cursorLimit(options?.limit)),

  delete: async (id: string) => db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning({ id: projects.id }),
};
