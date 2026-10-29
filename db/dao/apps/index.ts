import { db } from "db";
import { apps, type AppRecord, type AppInsert } from "db/schema/apps";
import { releases } from "db/schema/releases";
import { sourceMaps } from "db/schema/source-maps";
import { sourceMapTokens } from "db/schema/source-map-tokens";
import { alertChannels } from "db/schema/alert-channels";
import { alertRules } from "db/schema/alert-rules";
import { alertIncidents } from "db/schema/alert-incidents";
import { eq, and, asc, inArray, sql, gt } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorLimit } from "../cursor";
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
    const app = (
      await db
        .select(appResolveFields)
        .from(apps)
        .where(eq(apps.ingestKey, ingestKey))
        .limit(1)
    )[0];
    return app;
  },

  findByNumber: async (number: number) => {
    const app = (
      await db
        .select(appResolveFields)
        .from(apps)
        .where(eq(apps.number, number))
        .limit(1)
    )[0];
    return app;
  },

  findByPublicKey: async (
    publicKey: string,
  ): Promise<AppResolveRecord | undefined> => {
    const app = (
      await db
        .select(appResolveFields)
        .from(apps)
        .where(eq(apps.publicKey, publicKey))
        .limit(1)
    )[0];
    return app;
  },

  // The legacy DSN path carries the project id; the key picks the app.
  findByProjectAndPublicKey: async (
    projectId: string,
    publicKey: string,
  ): Promise<AppResolveRecord | undefined> => {
    const apps = await appDAO.listByProject(projectId, { limit: 1000 });
    const app = apps.find((candidate) => candidate.publicKey === publicKey);
    return app;
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
      .orderBy(asc(apps.id))
      .limit(cursorLimit(options?.limit)),

  // The issue query resolves an app by its exact name (case-insensitive).
  findByName: (name: string): Promise<{ id: string } | undefined> =>
    db
      .select({ id: apps.id })
      .from(apps)
      .where(sql`lower(${apps.name}) = lower(${name})`)
      .limit(1)
      .then(([row]) => row),

  delete: (id: string) => db.delete(apps).where(eq(apps.id, id)),
};
