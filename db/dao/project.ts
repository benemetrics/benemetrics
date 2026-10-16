import { db } from "db";
import { projects, apps, type Project, type ProjectInsert, type AppRecord, type AppInsert } from "db/schema/project";
import { releases } from "db/schema/releases";
import { sourceMaps } from "db/schema/source-maps";
import { sourceMapTokens } from "db/schema/source-map-tokens";
import { storedEvents } from "db/schema/stored-event";
import { alertChannels } from "db/schema/alert-channels";
import { alertRules } from "db/schema/alert-rules";
import { alertIncidents } from "db/schema/alert-incidents";
import { eq, asc, desc, sql } from "drizzle-orm";
import { conflict, internalError, notFound } from "backend/errors";

// The DSN honours the app's own protocol so local (http) apps get a
// usable DSN instead of an always-https one.
export function toAppResponse(app: AppRecord) {
  return {
    id: app.id,
    number: app.number,
    projectId: app.projectId,
    environmentId: app.environmentId,
    name: app.name,
    platform: app.platform,
    ingestKey: app.ingestKey,
    dsn: `${app.protocol}://${app.publicKey}@${app.host}/${app.number}`,
    publicKey: app.publicKey,
    host: app.host,
    protocol: app.protocol,
    createdAt: app.createdAt,
  };
}

export const projectDAO = {
  create: async (data: Omit<ProjectInsert, "id"> & { id?: string }) => {
    const [created] = await db
      .insert(projects)
      .values({ ...data, id: data.id ?? crypto.randomUUID(), createdAt: new Date().toISOString() })
      .onConflictDoNothing({ target: projects.slug })
      .returning();
    if (!created) {
      throw conflict(`Project slug already exists: ${data.slug}`);
    }
    return created;
  },

  findById: async (id: string): Promise<Project | undefined> =>
    (
      await db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1)
    )[0],

  findBySlug: async (slug: string): Promise<Project | undefined> =>
    (
      await db
        .select()
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const project = await projectDAO.findById(id);
    if (!project) throw notFound("Project", id);
    return project;
  },

  list: async (options?: { page?: number; limit?: number }) => {
    const page = Math.max(1, options?.page ?? 1);
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 500);
    const offset = (page - 1) * limit;

    const [rows, counts, total] = await Promise.all([
      db
        .select()
        .from(projects)
        .orderBy(desc(projects.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ projectId: apps.projectId, count: sql<number>`count(*)::int` })
        .from(apps)
        .groupBy(apps.projectId),
      db.$count(projects),
    ]);

    const countByProject = new Map(
      (counts as Array<{ projectId: string; count: number }>).map((row) => [
        row.projectId,
        Number(row.count),
      ]),
    );

    return {
      data: (rows as Project[]).map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        appCount: countByProject.get(project.id) ?? 0,
        createdAt: project.createdAt,
      })),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    };
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning({ id: projects.id });
    return deleted.length > 0;
  },
};

export const appDAO = {
  create: async (data: AppInsert) => {
    const [created] = await db
      .insert(apps)
      .values({ ...data, id: data.id ?? crypto.randomUUID(), createdAt: new Date().toISOString() })
      .returning();
    if (!created) {
      throw internalError("Failed to create app");
    }
    return created;
  },

  findById: async (id: string): Promise<AppRecord | undefined> =>
    (
      await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1)
    )[0],

  findByIngestKey: async (ingestKey: string): Promise<AppRecord | undefined> =>
    (
      await db
        .select()
        .from(apps)
        .where(eq(apps.ingestKey, ingestKey))
        .limit(1)
    )[0],

  findByNumber: async (number: number): Promise<AppRecord | undefined> =>
    (
      await db
        .select()
        .from(apps)
        .where(eq(apps.number, number))
        .limit(1)
    )[0],

  findByPublicKey: async (publicKey: string): Promise<AppRecord | undefined> =>
    (
      await db
        .select()
        .from(apps)
        .where(eq(apps.publicKey, publicKey))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const app = await appDAO.findById(id);
    if (!app) throw notFound("App", id);
    return app;
  },

  findByIngestKeyOrThrow: async (ingestKey: string) => {
    const app = await appDAO.findByIngestKey(ingestKey);
    if (!app) throw notFound("App for ingest key", ingestKey);
    return app;
  },

  listByProject: async (
    projectId: string,
    options?: { page?: number; limit?: number },
  ) => {
    const page = Math.max(1, options?.page ?? 1);
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(apps)
        .where(eq(apps.projectId, projectId))
        .orderBy(asc(apps.createdAt))
        .limit(limit)
        .offset(offset),
      db.$count(apps, eq(apps.projectId, projectId)),
    ]);

    return {
      data: rows.map(toAppResponse),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    };
  },

  // Events are linked to apps, so this powers environment-scoped event lists.
  listByEnvironment: async (environmentId: string): Promise<AppRecord[]> => {
    const rows = await db
      .select()
      .from(apps)
      .where(eq(apps.environmentId, environmentId))
      .orderBy(asc(apps.createdAt));
    return rows;
  },

  listRawByProject: async (projectId: string): Promise<AppRecord[]> => {
    const rows = await db
      .select()
      .from(apps)
      .where(eq(apps.projectId, projectId))
      .orderBy(asc(apps.createdAt));
    return rows;
  },

  listAll: async () => {
    const rows = await db
      .select()
      .from(apps)
      .orderBy(asc(apps.createdAt));
    return rows;
  },

  delete: async (id: string) => {
    // Business rule: deleting an app cascades to everything scoped
    // to it. Environments are project-scoped and shared, so they
    // survive app deletion.
    await db.delete(sourceMapTokens).where(eq(sourceMapTokens.appId, id));
    await db.delete(sourceMaps).where(eq(sourceMaps.appId, id));
    await db.delete(storedEvents).where(eq(storedEvents.appId, id));
    await db.delete(alertIncidents).where(eq(alertIncidents.appId, id));
    await db.delete(alertRules).where(eq(alertRules.appId, id));
    await db.delete(alertChannels).where(eq(alertChannels.appId, id));
    await db.delete(releases).where(eq(releases.appId, id));
    const deleted = await db
      .delete(apps)
      .where(eq(apps.id, id))
      .returning({ id: apps.id });
    return deleted.length > 0;
  },
};
