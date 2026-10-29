import { db } from "db";
import { segmentPublicFields, segments } from "db/schema/feature-flags";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";

type SegmentInsert = typeof segments.$inferInsert;

export const segmentDAO = {
  create: async (data: Omit<SegmentInsert, "id"> & { id?: string }) => {
    const [row] = await db
      .insert(segments)
      .values({ ...data })
      .returning(segmentPublicFields);
    if (!row) {
      throw internalError("Failed to create segment");
    }
    return row;
  },

  findById: (id: string) =>
    db
      .select(segmentPublicFields)
      .from(segments)
      .where(eq(segments.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const segment = await segmentDAO.findById(id);
    if (!segment) throw notFound("Segment", id);
    return segment;
  },

  list: async (options?: { cursor?: string; limit?: number }) => {
    const limit = cursorLimit(options?.limit);
    const where = whereNotNull(lt, segments.id, options?.cursor);

    const data = await db
      .select(segmentPublicFields)
      .from(segments)
      .where(where)
      .orderBy(desc(segments.id))
      .limit(limit);

    return data;
  },
};
