import { db } from "db";
import {
  sourceMaps,
  type SourceMapInsert,
} from "db/schema/source-maps";
import { and, desc, eq, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorAfter, cursorLimit } from "./cursor";

type SourceMapCreateInput = Omit<SourceMapInsert, "id" | "createdAt">;

export interface SourceMapContent {
  id: string;
  filename: string;
  mapJson: string;
  createdAt: string;
}

// The artifact metadata never carries the (potentially large) map body;
// `size` is derived in the database from the stored text.
const artifactFields = {
  id: sourceMaps.id,
  projectId: sourceMaps.projectId,
  appId: sourceMaps.appId,
  environmentId: sourceMaps.environmentId,
  release: sourceMaps.release,
  dist: sourceMaps.dist,
  name: sourceMaps.filename,
  size: sql<number>`octet_length(${sourceMaps.mapJson})`,
  createdAt: sourceMaps.createdAt,
};

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
      .returning(artifactFields);
    if (!created) {
      throw internalError("Failed to create source map");
    }
    return created;
  },

  findById: async (id: string) =>
    (
      await db
        .select(artifactFields)
        .from(sourceMaps)
        .where(eq(sourceMaps.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const map = await sourceMapDAO.findById(id);
    if (!map) throw notFound("Source map", id);
    return map;
  },

  // The admin detail endpoint only fetches the body when explicitly asked
  // (`?include=content`).
  findWithContentOrThrow: async (id: string) => {
    const [map] = await db
      .select({ ...artifactFields, mapJson: sourceMaps.mapJson })
      .from(sourceMaps)
      .where(eq(sourceMaps.id, id))
      .limit(1);
    if (!map) throw notFound("Source map", id);
    return map;
  },

  // Symbolication only needs the artifact identity and its body.
  findByRelease: async (
    projectId: string,
    release: string,
  ): Promise<SourceMapContent[]> =>
    db
      .select({
        id: sourceMaps.id,
        filename: sourceMaps.filename,
        mapJson: sourceMaps.mapJson,
        createdAt: sourceMaps.createdAt,
      })
      .from(sourceMaps)
      .where(
        and(eq(sourceMaps.projectId, projectId), eq(sourceMaps.release, release)),
      )
      .orderBy(desc(sourceMaps.createdAt)),

  list: async (options: {
    projectId?: string;
    appId?: string;
    environmentId?: string;
    release?: string;
    cursor?: string;
    limit?: number;
  }) => {
    const limit = cursorLimit(options.limit);
    const conditions = [
      ...(options.projectId
        ? [eq(sourceMaps.projectId, options.projectId)]
        : []),
      ...(options.appId ? [eq(sourceMaps.appId, options.appId)] : []),
      ...(options.environmentId
        ? [eq(sourceMaps.environmentId, options.environmentId)]
        : []),
      ...(options.release ? [eq(sourceMaps.release, options.release)] : []),
    ];
    const { condition, empty } = await cursorAfter(
      sourceMaps,
      sourceMaps.id,
      sourceMaps.createdAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    if (condition) conditions.push(condition);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await db
      .select(artifactFields)
      .from(sourceMaps)
      .where(where)
      .orderBy(desc(sourceMaps.createdAt), desc(sourceMaps.id))
      .limit(limit);

    return { data };
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(sourceMaps)
      .where(eq(sourceMaps.id, id))
      .returning({ id: sourceMaps.id });
    return deleted.length > 0;
  },

  // Deletes the artifact only when it is inside the caller's scope; an
  // artifact that is missing or belongs to someone else is left alone.
  deleteScoped: async (
    id: string,
    scope: { projectId: string; release: string; appId: string },
  ) => {
    await db
      .delete(sourceMaps)
      .where(
        and(
          eq(sourceMaps.id, id),
          eq(sourceMaps.projectId, scope.projectId),
          eq(sourceMaps.release, scope.release),
          eq(sourceMaps.appId, scope.appId),
        ),
      );
  },
};
