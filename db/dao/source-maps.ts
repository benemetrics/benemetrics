import { db } from "../index.ts";
import { sourceMaps } from "../schema/source-maps.ts";
import { eq, desc, and, ilike } from "drizzle-orm";
import { notFound } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const sourceMapDAO = {
  async create(data: {
    projectId: string;
    appId: string;
    environmentId: string;
    release: string;
    dist?: string;
    filename: string;
    mapJson: string;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(sourceMaps)
      .values({
        id,
        projectId: data.projectId,
        appId: data.appId,
        environmentId: data.environmentId,
        release: data.release,
        dist: data.dist ?? null,
        filename: data.filename,
        mapJson: data.mapJson,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();

    return result[0] ?? null;
  },

  async findById(id: string) {
    const result = await db.select().from(sourceMaps).where(eq(sourceMaps.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const map = await this.findById(id);
    if (!map) throw new Error("Source map not found");
    return map;
  },

  async findByRelease(projectId: string, release: string) {
    const result = await db
      .select()
      .from(sourceMaps)
      .where(and(eq(sourceMaps.projectId, projectId), eq(sourceMaps.release, release)))
      .orderBy(desc(sourceMaps.createdAt));
    return result;
  },

  async list(options: {
    projectId?: string;
    environmentId?: string;
    release?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(sourceMaps);

    const conditions = [];
    if (options.projectId) conditions.push(eq(sourceMaps.projectId, options.projectId));
    if (options.environmentId) conditions.push(eq(sourceMaps.environmentId, options.environmentId));
    if (options.release) conditions.push(eq(sourceMaps.release, options.release));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(desc(sourceMaps.createdAt)),
      db.$count(sourceMaps),
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

  async delete(id: string) {
    const result = await db.delete(sourceMaps).where(eq(sourceMaps.id, id)).returning();
    return result.length > 0;
  },
};