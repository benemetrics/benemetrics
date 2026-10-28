import { db } from "db";
import { apps, type AppRecord, type AppInsert } from "db/schema/project";
import { releases } from "db/schema/releases";
import { sourceMaps } from "db/schema/source-maps";
import { sourceMapTokens } from "db/schema/source-map-tokens";
import { alertChannels } from "db/schema/alert-channels";
import { alertRules } from "db/schema/alert-rules";
import { alertIncidents } from "db/schema/alert-incidents";
import { eq, and, asc, inArray, sql, gt } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorLimit } from "./cursor";
import type { AppResolveRecord } from "./project";

const appFields = {
  id: apps.id,
  number: apps.number,
  projectId: apps.projectId,
  name: apps.name,
  platform: apps.platform,
  publicKey: apps.publicKey,
  createdAt: apps.createdAt,
  updatedAt: apps.updatedAt,
};

const appResolveFields = {
  id: apps.id,
  number: apps.number,
  projectId: apps.projectId,
  publicKey: apps.publicKey,
};

const appProjectFields = {
  ...appResolveFields,
  name: apps.name,
  platform: apps.platform,
};

export interface AppProjectRecord extends AppResolveRecord {
  name: string;
  platform: string;
}

export interface AppResolveRecord {
  id: string;
  projectId: string;
  publicKey: string;
  number: number;
}

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
      .values(data)
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
      appIds?: string[];
    },
  ) => db
      .select(appFields)
      .from(apps)
      .where(and(eq(apps.projectId, projectId), options?.cursor ? gt(apps.id, options.cursor) : undefined))
      .orderBy(asc(apps.createdAt), asc(apps.id))
      .limit(cursorLimit(options?.limit)),

  // Used by ingestion resolution, project copying, and project deletion.
  listRawByProject: async (projectId: string): Promise<AppProjectRecord[]> =>
    db
      .select(appProjectFields)
      .from(apps)
      .where(eq(apps.projectId, projectId))
      .orderBy(asc(apps.createdAt)),

  // The apps that live in the given projects — the permission scope names the
  // projects directly, so the query filters instead of loading the whole table.
  listByProjectIds: async (
    projectIds: string[],
  ): Promise<Array<{ id: string; name: string; projectId: string }>> => {
    if (projectIds.length === 0) return [];
    return await db
      .select({
        id: apps.id,
        name: apps.name,
        projectId: apps.projectId,
      })
      .from(apps)
      .where(inArray(apps.projectId, projectIds))
      .orderBy(asc(apps.createdAt), asc(apps.id));
  },

  listByNameFixes: async (
    prefixes: string[],
  ) => {
    if (prefixes.length === 0) return [];
    const wanted = prefixes.map((prefix) => `${prefix.toLowerCase()}%`);
    return await db
      .select({
        id: apps.id,
        name: apps.name,
        projectId: apps.projectId,
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