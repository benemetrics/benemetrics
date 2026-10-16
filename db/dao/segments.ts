import { db } from "db";
import { segments, type Segment } from "db/schema/segments";
import { eq, desc } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";

type SegmentInsert = typeof segments.$inferInsert;

// `rules` is a JSON column stored as text; expose it parsed to callers.
function toSegment(row: Segment) {
  let rules: unknown[] = [];
  try {
    rules = row.rules ? JSON.parse(row.rules) : [];
  } catch {
    rules = [];
  }
  return { ...row, rules };
}

export const segmentDAO = {
  create: async (data: Omit<SegmentInsert, "id"> & { id?: string }) => {
    const [row] = await db
      .insert(segments)
      .values({
        ...data,
        id: data.id ?? crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();
    if (!row) {
      throw internalError("Failed to create segment");
    }
    return toSegment(row);
  },

  findById: async (id: string) => {
    const [row] = await db.select().from(segments).where(eq(segments.id, id)).limit(1);
    return row ? toSegment(row) : undefined;
  },

  findByIdOrThrow: async (id: string) => {
    const segment = await segmentDAO.findById(id);
    if (!segment) throw notFound("Segment", id);
    return segment;
  },

  list: async (options?: { page?: number; limit?: number }) => {
    const page = Math.max(1, options?.page ?? 1);
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(segments)
        .orderBy(desc(segments.createdAt))
        .limit(limit)
        .offset(offset),
      db.$count(segments),
    ]);

    return {
      data: rows.map(toSegment),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    };
  },
};
