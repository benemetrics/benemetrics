import { db } from "db";
import { environments, type EnvironmentInsert } from "db/schema/environments";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { conflict, internalError, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";
import { cursorAfter, cursorLimit, type CursorPage } from "./cursor";

type EnvironmentCreateInput = Omit<EnvironmentInsert, "id"> & { id?: string };

export interface EnvironmentResponse {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// `is_default` is exposed as a boolean, so the conversion is in the read.
const environmentFields = {
  id: environments.id,
  projectId: environments.projectId,
  name: environments.name,
  slug: environments.slug,
  isDefault: sql<boolean>`${environments.isDefault} = 1`,
  createdAt: environments.createdAt,
  updatedAt: environments.updatedAt,
};

const SLUG_CONSTRAINT = "environments_project_slug_idx";
const ONE_DEFAULT_CONSTRAINT = "environments_one_default_idx";

// Environments belong to a project and are shared by all
// of its apps; nothing here is app-scoped.
export const environmentDAO = {
  create: async (data: EnvironmentCreateInput) => {
    const now = new Date().toISOString();
    let created: EnvironmentResponse | undefined;
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
        .returning(environmentFields);
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
        .returning(environmentFields);
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

  // Resolves the environment an app is being created into: the named one
  // (by slug or display name, created when missing) or the project default.
  resolveForApp: async (projectId: string, environmentName?: string) => {
    if (!environmentName) {
      const defaultEnvironment = await environmentDAO.findDefault(projectId);
      if (defaultEnvironment) return defaultEnvironment;
      return environmentDAO.findOrCreate({ projectId, name: "Testing", slug: "testing", isDefault: 1 });
    }

    const slug = environmentName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug) {
      const existing = await environmentDAO.findByProjectAndSlug(projectId, slug);
      if (existing) return existing;
    }
    const byName = await environmentDAO.findByProjectAndName(projectId, environmentName);
    if (byName) return byName;

    const total = await environmentDAO.countByProject(projectId);
    return environmentDAO.findOrCreate({
      projectId,
      name: environmentName,
      slug: slug || crypto.randomUUID(),
      isDefault: total === 0 ? 1 : 0,
    });
  },

  findById: async (id: string): Promise<EnvironmentResponse | undefined> =>
    (
      await db
        .select(environmentFields)
        .from(environments)
        .where(eq(environments.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const environment = await environmentDAO.findById(id);
    if (!environment) throw notFound("Environment", id);
    return environment;
  },

  findByProjectAndSlug: async (projectId: string, slug: string): Promise<EnvironmentResponse | undefined> =>
    (
      await db
        .select(environmentFields)
        .from(environments)
        .where(and(eq(environments.projectId, projectId), eq(environments.slug, slug)))
        .limit(1)
    )[0],

  findByProjectAndName: async (projectId: string, name: string): Promise<EnvironmentResponse | undefined> =>
    (
      await db
        .select(environmentFields)
        .from(environments)
        .where(and(eq(environments.projectId, projectId), eq(environments.name, name)))
        .limit(1)
    )[0],

  // The issue query resolves an environment by its exact name
  // (case-insensitive), across every project.
  findByName: async (name: string): Promise<EnvironmentResponse[]> =>
    db
      .select(environmentFields)
      .from(environments)
      .where(sql`lower(${environments.name}) = lower(${name})`)
      .orderBy(asc(environments.createdAt)),

  findDefault: async (projectId: string): Promise<EnvironmentResponse | undefined> =>
    (
      await db
        .select(environmentFields)
        .from(environments)
        .where(and(eq(environments.projectId, projectId), eq(environments.isDefault, 1)))
        .limit(1)
    )[0],

  // The default-repair path only needs the candidate id.
  oldest: async (projectId: string): Promise<{ id: string } | undefined> =>
    (
      await db
        .select({ id: environments.id })
        .from(environments)
        .where(eq(environments.projectId, projectId))
        .orderBy(asc(environments.createdAt))
        .limit(1)
    )[0],

  // Project duplication copies name/slug/default only.
  listAllByProject: async (projectId: string) =>
    db
      .select({
        id: environments.id,
        name: environments.name,
        slug: environments.slug,
        isDefault: sql<boolean>`${environments.isDefault} = 1`,
      })
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(asc(environments.createdAt)),

  list: async (options: {
    projectId?: string;
    cursor?: string;
    limit?: number;
    /** The visible environments of a scoped identity. */
    environmentIds?: string[];
  }): Promise<CursorPage<EnvironmentResponse>> => {
    const limit = cursorLimit(options.limit);
    const scope = options.projectId
      ? eq(environments.projectId, options.projectId)
      : options.environmentIds && options.environmentIds.length > 0
        ? inArray(environments.id, options.environmentIds)
        : undefined;
    const { condition, empty } = await cursorAfter(
      environments,
      environments.id,
      environments.createdAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    const where = scope && condition ? and(scope, condition) : (scope ?? condition);

    const data = await db
      .select(environmentFields)
      .from(environments)
      .where(where)
      .orderBy(desc(environments.createdAt), desc(environments.id))
      .limit(limit);

    return { data };
  },

  // The scope engine matches environment names across every project.
  // The environments whose name is in the list (case-insensitive) — the
  // permission scope names them, so the query filters instead of loading
  // the whole table.
  listByNames: async (names: string[]): Promise<EnvironmentResponse[]> => {
    if (names.length === 0) return [];
    const wanted = names.map((name) => name.toLowerCase());
    return await db
      .select(environmentFields)
      .from(environments)
      .where(
        sql`lower(${environments.name}) in (${sql.join(
          wanted.map((name) => sql`${name}`),
          sql`, `,
        )})`,
      )
      .orderBy(asc(environments.createdAt));
  },

  // The environments with the given ids.
  listByIds: async (ids: string[]): Promise<EnvironmentResponse[]> => {
    if (ids.length === 0) return [];
    return await db
      .select(environmentFields)
      .from(environments)
      .where(inArray(environments.id, ids))
      .orderBy(asc(environments.createdAt));
  },

  listAll: async (): Promise<EnvironmentResponse[]> =>
    db.select(environmentFields).from(environments).orderBy(asc(environments.createdAt)),

  countByProject: async (projectId: string): Promise<number> =>
    Number(await db.$count(environments, eq(environments.projectId, projectId))),

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

  // The caller only needs the side effect; repairing the default never
  // reads the promoted row back.
  markDefault: async (id: string): Promise<void> => {
    await db
      .update(environments)
      .set({ isDefault: 1, updatedAt: new Date().toISOString() })
      .where(eq(environments.id, id));
  },

  // Restores the "exactly one default per project" invariant.
  ensureDefault: async (projectId: string): Promise<void> => {
    const [current, oldest] = await Promise.all([
      environmentDAO.findDefault(projectId),
      environmentDAO.oldest(projectId),
    ]);
    if (current || !oldest) return;
    try {
      await environmentDAO.markDefault(oldest.id);
    } catch (err) {
      if (uniqueViolationConstraint(err) !== ONE_DEFAULT_CONSTRAINT) throw err;
    }
  },

  updateOrThrow: async (id: string, data: Partial<EnvironmentInsert>) => {
    try {
      const updated = (
        await db
          .update(environments)
          .set({ ...data, updatedAt: new Date().toISOString() })
          .where(eq(environments.id, id))
          .returning(environmentFields)
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
