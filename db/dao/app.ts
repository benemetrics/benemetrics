import { db } from "db";
import { apps, type AppRecord, type AppInsert } from "db/schema/app";
import { releases } from "db/schema/releases";
import { sourceMaps } from "db/schema/source-maps";
import { sourceMapTokens } from "db/schema/source-map-tokens";
import { alertChannels } from "db/schema/alert-channels";
import { alertRules } from "db/schema/alert-rules";
import { alertIncidents } from "db/schema/alert-incidents";
import { eq, and, asc, inArray, sql, gt } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorLimit } from "./cursor";
import { appPublicFields } from "db/schema/app";
import { whereNotNull } from "db/utils";

export const appDAO = {
  create: async (data: AppInsert) => {
    const [created] = await db
      .insert(apps)
      .values(data)
      .returning(appPublicFields);
    if (!created) internalError("Failed to create app");
    return created;
  },

  findById: (id: string): Promise<AppRecord | undefined> =>
    db
      .select(appPublicFields)
      .from(apps)
      .where(eq(apps.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIngestKey: async (ingestKey: string) => {
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

  findByNumber: async (number: number) => {
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

  listByProject: (
    projectId: string,
    options?: {
      cursor?: string;
      limit?: number;
      appIds?: string[];
    },
  ) =>
    db
      .select(appPublicFields)
      .from(apps)
      .where(
        and(
          eq(apps.projectId, projectId),
          whereNotNull(gt, apps.id, options?.cursor),
        ),
      )
      .orderBy(asc(apps.createdAt), asc(apps.id))
      .limit(cursorLimit(options?.limit)),

  listByNameFixes: async (prefixes: string[]) => {
    if (prefixes.length === 0) return [];

    return db
      .select({
        id: apps.id,
        name: apps.name,
        projectId: apps.projectId,
      })
      .from(apps)
      .where(
        sql.join(
          prefixes.map(
            (prefix) => sql`lower(${apps.name}) like %${prefix.toLowerCase()}%`,
          ),
          sql` or `,
        ),
      )
      .orderBy(asc(apps.createdAt))
      .limit(100);
  },

  // The issue query resolves an app by its exact name (case-insensitive).
  findByName: (name: string): Promise<{ id: string } | undefined> =>
    db
      .select({ id: apps.id })
      .from(apps)
      .where(sql`lower(${apps.name}) = lower(${name})`)
      .limit(1)
      .then(([row]) => row),

  delete: async (id: string) => {
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
