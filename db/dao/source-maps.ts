import { db } from "db";
import {
  artifactPublicFields,
  sourceMaps,
  type SourceMapInsert,
} from "db/schema/source-maps";
import { and, desc, eq, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorLimit } from "./cursor";
import { apps } from "db/schema/apps";
import { whereNotNull } from "db/utils";

// The artifact metadata never carries the (potentially large) map body;
// `size` is derived in the database from the stored text.
export const sourceMapDAO = {
  create: async (data: SourceMapInsert) => {
    const [created] = await db
      .insert(sourceMaps)
      .values(data)
      // Re-uploading the same artifact updates it in place.
      .onConflictDoUpdate({
        target: [sourceMaps.projectId, sourceMaps.release, sourceMaps.filename],
        set: data,
      })
      .returning(artifactPublicFields);
    if (!created) throw internalError("Failed to create source map");
    return created;
  },

  findById: (id: string) =>
    db
      .select(artifactPublicFields)
      .from(sourceMaps)
      .where(eq(sourceMaps.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const map = await sourceMapDAO.findById(id);
    if (!map) throw notFound("Source map", id);
    return map;
  },

  // Symbolication only needs the artifact identity and its body.
  findByRelease: (projectId: string, release: string) =>
    db
      .select({
        id: sourceMaps.id,
        filename: sourceMaps.filename,
        mapJson: sourceMaps.mapJson,
        createdAt: sourceMaps.createdAt,
      })
      .from(sourceMaps)
      .where(
        and(
          eq(sourceMaps.projectId, projectId),
          eq(sourceMaps.release, release),
        ),
      )
      .orderBy(desc(sourceMaps.createdAt)),

  list: (
    options: { appId?: (typeof apps)["id"] },
    page: { cursor?: string; limit?: number },
  ) =>
    db
      .select(artifactPublicFields)
      .from(sourceMaps)
      .where(and(whereNotNull(eq, sourceMaps.appId, options.appId)))
      .orderBy(desc(sourceMaps.createdAt), desc(sourceMaps.id))
      .limit(cursorLimit(page?.limit)),

  delete: async (id: string) => {
    const deleted = await db
      .delete(sourceMaps)
      .where(eq(sourceMaps.id, id))
      .returning({ id: sourceMaps.id });
    return deleted.length > 0;
  },

  // Deletes the artifact only when it is inside the caller's scope; an
  // artifact that is missing or belongs to someone else is left alone.
  deleteScoped: (
    id: string,
    scope: { projectId: string; release: string; appId: string },
  ) =>
    db
      .delete(sourceMaps)
      .where(
        and(
          eq(sourceMaps.id, id),
          eq(sourceMaps.projectId, scope.projectId),
          eq(sourceMaps.release, scope.release),
          eq(sourceMaps.appId, scope.appId),
        ),
      ),
};
