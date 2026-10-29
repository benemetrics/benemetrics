import { db } from "db";
import { segments } from "db/schema/segments";
import { desc, eq, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorAfter, cursorLimit } from "./cursor";

type SegmentInsert = typeof segments.$inferInsert;

// `rules` is a JSON text column; decode it in the read so callers get the
// protocol shape directly.
const segmentFields = {
  id: segments.id,
  name: segments.name,
  description: segments.description,
  rules: sql<unknown[]>`${segments.rules}::jsonb`,
  createdAt: segments.createdAt,
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

  findById: async (id: string) => {
    const [row] = await db
      .select(segmentFields)
      .from(segments)
      .where(eq(segments.id, id))
      .limit(1);
    return row;
  },

  findByIdOrThrow: async (id: string) => {
    const segment = await segmentDAO.findById(id);
    if (!segment) throw notFound("Segment", id);
    return segment;
  },

  list: async (options?: { cursor?: string; limit?: number }) => {
    const limit = cursorLimit(options?.limit);
    const { condition, empty } = await cursorAfter(
      segments,
      segments.id,
      segments.createdAt,
      options?.cursor,
    );
    if (empty) return { data: [] };

    const data = await db
      .select(segmentFields)
      .from(segments)
      .where(condition)
      .orderBy(desc(segments.createdAt), desc(segments.id))
      .limit(limit);

    return { data };
  },
};
