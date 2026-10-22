import { db } from "db";
import { projects, apps, type Project, type ProjectInsert, type AppRecord, type AppInsert } from "db/schema/project";
import { releases } from "db/schema/releases";
import { sourceMaps } from "db/schema/source-maps";
import { sourceMapTokens } from "db/schema/source-map-tokens";
import { alertChannels } from "db/schema/alert-channels";
import { alertRules } from "db/schema/alert-rules";
import { alertIncidents } from "db/schema/alert-incidents";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import { ApiError, ErrorCode, conflict, internalError, notFound } from "backend/errors";
import { environmentDAO, type EnvironmentResponse } from "./environments";
import { cursorAfter, cursorLimit } from "./cursor";

// Ingestion only needs the identity and credentials of the resolved app.
export interface AppResolveRecord {
  id: string;
  projectId: string;
  publicKey: string;
}

// Project deletion/copying needs the app's environment and display fields;
// ingestion additionally needs the credentials above.
export interface AppProjectRecord extends AppResolveRecord {
  environmentId: string;
  name: string;
  platform: string;
}

const projectFields = {
  id: projects.id,
  name: projects.name,
  slug: projects.slug,
  description: projects.description,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

const appFields = {
  id: apps.id,
  number: apps.number,
  projectId: apps.projectId,
  environmentId: apps.environmentId,
  name: apps.name,
  platform: apps.platform,
  ingestKey: apps.ingestKey,
  publicKey: apps.publicKey,
  createdAt: apps.createdAt,
  updatedAt: apps.updatedAt,
};

const appResolveFields = {
  id: apps.id,
  projectId: apps.projectId,
  publicKey: apps.publicKey,
};

const appProjectFields = {
  ...appResolveFields,
  environmentId: apps.environmentId,
  name: apps.name,
  platform: apps.platform,
};

// App DSNs are built from the host the user reached the backend through
// (see backend/host.ts), so nothing deployment-specific is stored in the
// database: the admin response middleware appends the DSN at read time.

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

  // Retries slug suffixes when the insert hits the unique index. The
  // conflict is still resolved by the database, never by a pre-read.
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

  // Copies the project with its environments and apps; response shaping
  // (DSN host) stays out of the DAO.
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

    const sourceEnvironments = await environmentDAO.listAllByProject(sourceId);
    let environments: EnvironmentResponse[] = await Promise.all(
      sourceEnvironments.map((sourceEnvironment) =>
        environmentDAO.create({
          projectId: project.id,
          name: sourceEnvironment.name,
          slug: sourceEnvironment.slug,
          isDefault: sourceEnvironment.isDefault ? 1 : 0,
        }),
      ),
    );
    const environmentIdMap = new Map(
      sourceEnvironments.map((sourceEnvironment, index) => [sourceEnvironment.id, environments[index]!.id]),
    );
    if (environments.length === 0) {
      environments = [
        await environmentDAO.create({ projectId: project.id, name: "Testing", slug: "testing", isDefault: 1 }),
      ];
    } else if (!environments.some((environment) => environment.isDefault)) {
      await environmentDAO.markDefault(environments[0]!.id);
    }

    const defaultEnvironmentId =
      environments.find((environment) => environment.isDefault)?.id ??
      environments[0]!.id;
    const duplicatedApps = await Promise.all(
      (await appDAO.listRawByProject(sourceId)).map(
        async (sourceApp): Promise<{ app: AppRecord; environment: EnvironmentResponse }> => {
          const environmentId =
            environmentIdMap.get(sourceApp.environmentId) ?? defaultEnvironmentId;
          const environment = environments.find((entry) => entry.id === environmentId);
          if (!environment) throw internalError("Duplicated app has no environment");
          return {
            app: await appDAO.create({
              id: crypto.randomUUID(),
              projectId: project.id,
              environmentId,
              name: sourceApp.name,
              platform: sourceApp.platform,
              ingestKey: `${project.slug}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
              publicKey: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
            }),
            environment,
          };
        },
      ),
    );

    return { project, environments, apps: duplicatedApps };
  },

  findById: async (id: string): Promise<Project | undefined> =>
    (
      await db
        .select(projectFields)
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1)
    )[0],

  // Upload auth only needs the project identity to match the token scope.
  findBySlug: async (slug: string): Promise<{ id: string } | undefined> =>
    (
      await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, slug))
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
    /** The visible projects of a scoped identity. */
    projectIds?: string[];
  }) => {
    const limit = cursorLimit(options?.limit);
    const { condition, empty } = await cursorAfter(
      projects,
      projects.id,
      projects.createdAt,
      options?.cursor,
    );
    if (empty) return { data: [] };
    const scope =
      options?.projectIds && options.projectIds.length > 0
        ? inArray(projects.id, options.projectIds)
        : undefined;
    const where = scope && condition ? and(scope, condition) : (scope ?? condition);

    const [rows, counts] = await Promise.all([
      db
        .select(projectFields)
        .from(projects)
        .where(where)
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .limit(limit),
      db
        .select({ projectId: apps.projectId, count: sql<number>`count(*)::int` })
        .from(apps)
        .groupBy(apps.projectId),
    ]);

    const countByProject = new Map(
      (counts as Array<{ projectId: string; count: number }>).map((row) => [
        row.projectId,
        Number(row.count),
      ]),
    );

    return {
      data: rows.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        appCount: countByProject.get(project.id) ?? 0,
        createdAt: project.createdAt,
      })),
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

// The DSN resolution runs on every ingested event, so the resolved app is
// cached for a short while: the same path segment always resolves to the
// same app. The entries expire, so a deleted app stops resolving on its
// own; the delete purges them right away.
const APP_CACHE_TTL_MS = 60_000;
const APP_CACHE_MAX = 1000;
const appCache = new Map<string, { app: AppResolveRecord; expiresAt: number }>();

function cachedApp(key: string): AppResolveRecord | undefined {
  const hit = appCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    appCache.delete(key);
    return undefined;
  }
  return hit.app;
}

function cacheApp(key: string, app: AppResolveRecord): AppResolveRecord {
  if (appCache.size >= APP_CACHE_MAX) appCache.clear();
  appCache.set(key, { app, expiresAt: Date.now() + APP_CACHE_TTL_MS });
  return app;
}

function purgeAppCache(appId: string): void {
  for (const [key, entry] of appCache) {
    if (entry.app.id === appId) appCache.delete(key);
  }
}

export const appDAO = {
  create: async (data: AppInsert) => {
    const [created] = await db
      .insert(apps)
      .values({ ...data, id: data.id ?? crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .returning(appFields);
    if (!created) {
      throw internalError("Failed to create app");
    }
    return created;
  },

  findById: async (id: string): Promise<AppRecord | undefined> =>
    (
      await db
        .select(appFields)
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1)
    )[0],

  findByIngestKey: async (
    ingestKey: string,
  ): Promise<AppResolveRecord | undefined> => {
    const cached = cachedApp(`ingest:${ingestKey}`);
    if (cached) return cached;
    const app = (
      await db
        .select(appResolveFields)
        .from(apps)
        .where(eq(apps.ingestKey, ingestKey))
        .limit(1)
    )[0];
    return app ? cacheApp(`ingest:${ingestKey}`, app) : undefined;
  },

  findByNumber: async (number: number): Promise<AppResolveRecord | undefined> => {
    const cached = cachedApp(`number:${number}`);
    if (cached) return cached;
    const app = (
      await db
        .select(appResolveFields)
        .from(apps)
        .where(eq(apps.number, number))
        .limit(1)
    )[0];
    return app ? cacheApp(`number:${number}`, app) : undefined;
  },

  findByPublicKey: async (
    publicKey: string,
  ): Promise<AppResolveRecord | undefined> => {
    const cached = cachedApp(`public:${publicKey}`);
    if (cached) return cached;
    const app = (
      await db
        .select(appResolveFields)
        .from(apps)
        .where(eq(apps.publicKey, publicKey))
        .limit(1)
    )[0];
    return app ? cacheApp(`public:${publicKey}`, app) : undefined;
  },

  // The legacy DSN path carries the project id; the key picks the app.
  findByProjectAndPublicKey: async (
    projectId: string,
    publicKey: string,
  ): Promise<AppResolveRecord | undefined> => {
    const cached = cachedApp(`project:${projectId}:${publicKey}`);
    if (cached) return cached;
    const apps = await appDAO.listRawByProject(projectId);
    const app = apps.find((candidate) => candidate.publicKey === publicKey);
    return app ? cacheApp(`project:${projectId}:${publicKey}`, app) : undefined;
  },

  findByIdOrThrow: async (id: string) => {
    const app = await appDAO.findById(id);
    if (!app) throw notFound("App", id);
    return app;
  },

  listByProject: async (
    projectId: string,
    options?: {
      cursor?: string;
      limit?: number;
      /** The visible apps of a scoped identity. */
      appIds?: string[];
    },
  ) => {
    const limit = cursorLimit(options?.limit);
    const projectScope = eq(apps.projectId, projectId);
    const scope =
      options?.appIds && options.appIds.length > 0
        ? and(projectScope, inArray(apps.id, options.appIds))
        : projectScope;
    const { condition, empty } = await cursorAfter(
      apps,
      apps.id,
      apps.createdAt,
      options?.cursor,
      "asc",
    );
    if (empty) return { data: [] };
    const where = condition ? and(scope, condition) : scope;

    const data = await db
      .select(appFields)
      .from(apps)
      .where(where)
      .orderBy(asc(apps.createdAt), asc(apps.id))
      .limit(limit);

    // Raw rows: the response middleware appends the request-host DSN.
    return { data };
  },

  // Environment deletes and scoped event lists only need the app ids.
  listByEnvironment: async (
    environmentId: string,
  ): Promise<{ id: string }[]> =>
    db
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.environmentId, environmentId))
      .orderBy(asc(apps.createdAt)),

  // Used by ingestion resolution, project copying, and project deletion.
  listRawByProject: async (projectId: string): Promise<AppProjectRecord[]> =>
    db
      .select(appProjectFields)
      .from(apps)
      .where(eq(apps.projectId, projectId))
      .orderBy(asc(apps.createdAt)),

  // The alert sweeper only evaluates each app by id.
  // The scope engine matches app names and environments.
  listAll: async (): Promise<
    Array<{ id: string; name: string; projectId: string; environmentId: string }>
  > =>
    db
      .select({
        id: apps.id,
        name: apps.name,
        projectId: apps.projectId,
        environmentId: apps.environmentId,
      })
      .from(apps)
      .orderBy(asc(apps.createdAt)),

  // The apps whose name starts with one of the prefixes (case-insensitive)
  // — the permission scope names the prefixes, so the query filters
  // instead of loading the whole table.
  listByNamePrefixes: async (
    prefixes: string[],
  ): Promise<
    Array<{ id: string; name: string; projectId: string; environmentId: string }>
  > => {
    if (prefixes.length === 0) return [];
    const wanted = prefixes.map((prefix) => `${prefix.toLowerCase()}%`);
    return await db
      .select({
        id: apps.id,
        name: apps.name,
        projectId: apps.projectId,
        environmentId: apps.environmentId,
      })
      .from(apps)
      .where(
        sql`(${sql.join(
          wanted.map((pattern) => sql`lower(${apps.name}) like ${pattern}`),
          sql` or `,
        )})`,
      )
      .orderBy(asc(apps.createdAt));
  },

  // The apps that live in the given environments.
  listByEnvironmentIds: async (
    environmentIds: string[],
  ): Promise<
    Array<{ id: string; name: string; projectId: string; environmentId: string }>
  > => {
    if (environmentIds.length === 0) return [];
    return await db
      .select({
        id: apps.id,
        name: apps.name,
        projectId: apps.projectId,
        environmentId: apps.environmentId,
      })
      .from(apps)
      .where(inArray(apps.environmentId, environmentIds))
      .orderBy(asc(apps.createdAt));
  },

  // The issue query resolves an app by its exact name (case-insensitive).
  findByName: async (name: string): Promise<{ id: string } | undefined> =>
    (
      await db
        .select({ id: apps.id })
        .from(apps)
        .where(sql`lower(${apps.name}) = lower(${name})`)
        .limit(1)
    )[0],

  delete: async (id: string) => {
    // Environments are project-scoped and shared, so they survive.
    purgeAppCache(id);
    await Promise.all([
      db.delete(sourceMapTokens).where(eq(sourceMapTokens.appId, id)),
      db.delete(sourceMaps).where(eq(sourceMaps.appId, id)),
      db.delete(alertIncidents).where(eq(alertIncidents.appId, id)),
      db.delete(alertRules).where(eq(alertRules.appId, id)),
      db.delete(alertChannels).where(eq(alertChannels.appId, id)),
      db.delete(releases).where(eq(releases.appId, id)),
    ]);
    const deleted = await db
      .delete(apps)
      .where(eq(apps.id, id))
      .returning({ id: apps.id });
    return deleted.length > 0;
  },
};
