import { db } from "db";
import {
  sourceMaps,
  type SourceMap,
  type SourceMapInsert,
} from "db/schema/source-maps";
import { and, desc, eq } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";

type SourceMapCreateInput = Omit<SourceMapInsert, "id" | "createdAt">;

export const sourceMapDAO = {
  create: async (data: SourceMapCreateInput) => {
    const now = new Date().toISOString();
    const [created] = await db
      .insert(sourceMaps)
      .values({
        ...data,
        id: crypto.randomUUID(),
        createdAt: now,
      })
      // Re-uploading the same artifact updates it in place.
      .onConflictDoUpdate({
        target: [sourceMaps.projectId, sourceMaps.release, sourceMaps.filename],
        set: {
          appId: data.appId,
          environmentId: data.environmentId,
          dist: data.dist ?? null,
          mapJson: data.mapJson,
          createdAt: now,
        },
      })
      .returning();
    if (!created) {
      throw internalError("Failed to create source map");
    }
    return created;
  },

  findById: async (id: string): Promise<SourceMap | undefined> =>
    (
      await db
        .select()
        .from(sourceMaps)
        .where(eq(sourceMaps.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const map = await sourceMapDAO.findById(id);
    if (!map) throw notFound("Source map", id);
    return map;
  },

  findByRelease: async (
    projectId: string,
    release: string,
  ): Promise<SourceMap[]> =>
    db
      .select()
      .from(sourceMaps)
      .where(
        and(eq(sourceMaps.projectId, projectId), eq(sourceMaps.release, release)),
      )
      .orderBy(desc(sourceMaps.createdAt)),

  list: async (options: {
    projectId?: string;
    environmentId?: string;
    release?: string;
    page?: number;
    limit?: number;
  }) => {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions = [
      ...(options.projectId
        ? [eq(sourceMaps.projectId, options.projectId)]
        : []),
      ...(options.environmentId
        ? [eq(sourceMaps.environmentId, options.environmentId)]
        : []),
      ...(options.release ? [eq(sourceMaps.release, options.release)] : []),
    ];
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(sourceMaps)
        .where(where)
        .orderBy(desc(sourceMaps.createdAt))
        .limit(limit)
        .offset(offset),
      db.$count(sourceMaps, where),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(sourceMaps)
      .where(eq(sourceMaps.id, id))
      .returning({ id: sourceMaps.id });
    return deleted.length > 0;
  },

  deleteByApp: async (appId: string) => {
    await db.delete(sourceMaps).where(eq(sourceMaps.appId, appId));
  },
};
