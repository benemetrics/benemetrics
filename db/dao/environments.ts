import { db } from "db";
import { environments, type Environment, type EnvironmentInsert } from "db/schema/environments";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { conflict, internalError, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";

type EnvironmentCreateInput = Omit<EnvironmentInsert, "id"> & { id?: string };

const SLUG_CONSTRAINT = "environments_project_slug_idx";
const ONE_DEFAULT_CONSTRAINT = "environments_one_default_idx";

// Environments belong to a project and are shared by all
// of its apps; nothing here is app-scoped.
export const environmentDAO = {
  create: async (data: EnvironmentCreateInput) => {
    const now = new Date().toISOString();
    let created: Environment | undefined;
    try {
      [created] = await db
        .insert(environments)
        .values({
          ...data,
          id: data.id ?? crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [environments.projectId, environments.slug],
        })
        .returning();
    } catch (err) {
      if (uniqueViolationConstraint(err) === ONE_DEFAULT_CONSTRAINT) {
        throw conflict("Only one environment can be the default for a project");
      }
      throw err;
    }
    if (!created) {
      throw conflict(`Environment slug already exists for project: ${data.slug}`);
    }
    return created;
  },

  // Used where an environment is provisioned implicitly (an app created
  // in a not-yet-existing environment).
  findOrCreate: async (data: EnvironmentCreateInput) => {
    const insert = async (isDefault: number) => {
      const now = new Date().toISOString();
      const [created] = await db
        .insert(environments)
        .values({
          ...data,
          isDefault,
          id: data.id ?? crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [environments.projectId, environments.slug],
        })
        .returning();
      return created;
    };

    try {
      const created = await insert(data.isDefault ?? 0);
      if (created) return created;
    } catch (err) {
      if (uniqueViolationConstraint(err) !== ONE_DEFAULT_CONSTRAINT) throw err;
      const retry = await insert(0);
      if (retry) return retry;
    }

    const existing = await environmentDAO.findByProjectAndSlug(
      data.projectId,
      data.slug,
    );
    if (!existing) throw internalError("Failed to create environment");
    return existing;
  },

  findById: async (id: string): Promise<Environment | undefined> =>
    (
      await db
        .select()
        .from(environments)
        .where(eq(environments.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const environment = await environmentDAO.findById(id);
    if (!environment) throw notFound("Environment", id);
    return environment;
  },

  findByProjectAndSlug: async (projectId: string, slug: string): Promise<Environment | undefined> =>
    (
      await db
        .select()
        .from(environments)
        .where(and(eq(environments.projectId, projectId), eq(environments.slug, slug)))
        .limit(1)
    )[0],

  findByProjectAndName: async (projectId: string, name: string): Promise<Environment | undefined> =>
    (
      await db
        .select()
        .from(environments)
        .where(and(eq(environments.projectId, projectId), eq(environments.name, name)))
        .limit(1)
    )[0],

  findDefault: async (projectId: string): Promise<Environment | undefined> =>
    (
      await db
        .select()
        .from(environments)
        .where(and(eq(environments.projectId, projectId), eq(environments.isDefault, 1)))
        .limit(1)
    )[0],

  oldest: async (projectId: string): Promise<Environment | undefined> =>
    (
      await db
        .select()
        .from(environments)
        .where(eq(environments.projectId, projectId))
        .orderBy(asc(environments.createdAt))
        .limit(1)
    )[0],

  listAllByProject: async (projectId: string): Promise<Environment[]> =>
    db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(asc(environments.createdAt)),

  list: async (options: {
    projectId: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: Environment[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const where = eq(environments.projectId, options.projectId);

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(environments)
        .where(where)
        .orderBy(desc(environments.createdAt))
        .limit(limit)
        .offset(offset),
      db.$count(environments, where),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  clearDefault: async (projectId: string, exceptId?: string) => {
    await db
      .update(environments)
      .set({ isDefault: 0 })
      .where(
        exceptId
          ? and(eq(environments.projectId, projectId), ne(environments.id, exceptId))
          : eq(environments.projectId, projectId),
      );
  },

  markDefault: async (id: string) =>
    (
      await db
        .update(environments)
        .set({ isDefault: 1, updatedAt: new Date().toISOString() })
        .where(eq(environments.id, id))
        .returning()
    )[0],

  // Guarantees the "exactly one default per project" invariant after
  // mutations: promotes the oldest environment when the project is left
  // without a default.
  ensureDefault: async (projectId: string) => {
    const current = await environmentDAO.findDefault(projectId);
    if (current) return current;
    const oldest = await environmentDAO.oldest(projectId);
    if (!oldest) return undefined;
    try {
      return await environmentDAO.markDefault(oldest.id);
    } catch (err) {
      if (uniqueViolationConstraint(err) !== ONE_DEFAULT_CONSTRAINT) throw err;
      return environmentDAO.findDefault(projectId);
    }
  },

  updateOrThrow: async (id: string, data: Partial<EnvironmentInsert>) => {
    try {
      const updated = (
        await db
          .update(environments)
          .set({ ...data, updatedAt: new Date().toISOString() })
          .where(eq(environments.id, id))
          .returning()
      )[0];
      if (!updated) throw notFound("Environment", id);
      return updated;
    } catch (err) {
      const constraint = uniqueViolationConstraint(err);
      if (constraint === SLUG_CONSTRAINT) {
        throw conflict(`Environment slug already exists for project: ${data.slug}`);
      }
      if (constraint === ONE_DEFAULT_CONSTRAINT) {
        throw conflict("Only one environment can be the default for a project");
      }
      throw err;
    }
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(environments)
      .where(eq(environments.id, id))
      .returning({ id: environments.id });
    return deleted.length > 0;
  },

  deleteByProject: async (projectId: string) => {
    await db.delete(environments).where(eq(environments.projectId, projectId));
  },
};
