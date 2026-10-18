import { db } from "../index.ts";
import { segments } from "../schema/segments.ts";
import { eq, desc, ilike, or } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const segmentDAO = {
  async create(data: { name: string; description?: string; rules?: unknown[] }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(segments)
      .values({
        id,
        name: data.name,
        description: data.description ?? "",
        rules: JSON.stringify(data.rules ?? []),
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict(`Segment with name "${data.name}" already exists`);
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(segments).where(eq(segments.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const segment = await this.findById(id);
    if (!segment) throw notFound("Segment", id);
    return segment;
  },

  async list(options: { page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const [data, totalResult] = await Promise.all([
      db.select().from(segments).limit(limit).offset(offset).orderBy(desc(segments.createdAt)),
      db.$count(segments),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total: totalResult,
        totalPages: Math.ceil(totalResult / limit),
      },
    };
  },
};