import { db } from "db";
import { segments } from "db/schema/segments";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorLimit } from "../cursor";

type SegmentInsert = typeof segments.$inferInsert;

// `rules` is a JSON text column; decode it in the read so callers get the
// protocol shape directly.
const segmentFields = {
  id: segments.id,
  name: segments.name,
  description: segments.description,
  rules: sql<unknown[]>`${segments.rules}::jsonb`,
};

export const segmentDAO = {
  create: async (data: Omit<SegmentInsert, "id"> & { id?: string }) => {
    const [row] = await db
      .insert(segments)
      .values({ ...data })
      .returning(segmentFields);
    if (!row) {
      throw internalError("Failed to create segment");
    }
    return row;
  },

  findById: (id: string) =>
    db
      .select(segmentFields)
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
    const conditions = [
      ...(options?.cursor ? [lt(segments.id, options.cursor)] : []),
    ];
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await db
      .select(segmentFields)
      .from(segments)
      .where(where)
      .orderBy(desc(segments.id))
      .limit(limit);

    return data;
  },
};
