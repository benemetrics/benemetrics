import { db } from "../index.ts";
import { apps } from "../schema/apps.ts";
import { eq, and } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const appDAO = {
  async create(data: {
    projectId: string;
    environmentId: string;
    name: string;
    platform?: string;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const ingestKey = crypto.randomUUID();
    const publicKey = crypto.randomUUID();

    const result = await db
      .insert(apps)
      .values({
        id,
        projectId: data.projectId,
        environmentId: data.environmentId,
        name: data.name,
        platform: data.platform ?? "javascript",
        ingestKey,
        publicKey,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict("App creation failed (possible duplicate)");
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const app = await this.findById(id);
    if (!app) throw notFound("App", id);
    return app;
  },

  async findByNumber(projectId: string, number: number) {
    const result = await db
      .select()
      .from(apps)
      .where(and(eq(apps.projectId, projectId), eq(apps.number, number)))
      .limit(1);
    return result[0];
  },

  async findByIngestKey(ingestKey: string) {
    const result = await db.select().from(apps).where(eq(apps.ingestKey, ingestKey)).limit(1);
    return result[0];
  },

  async findByPublicKey(publicKey: string) {
    const result = await db.select().from(apps).where(eq(apps.publicKey, publicKey)).limit(1);
    return result[0];
  },

  async findByProjectAndPublicKey(projectId: string, publicKey: string) {
    const result = await db
      .select()
      .from(apps)
      .where(and(eq(apps.projectId, projectId), eq(apps.publicKey, publicKey)))
      .limit(1);
    return result[0];
  },

  async listByProject(projectId: string, options: { page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const [data, totalResult] = await Promise.all([
      db
        .select()
        .from(apps)
        .where(eq(apps.projectId, projectId))
        .limit(limit)
        .offset(offset)
        .orderBy(apps.createdAt),
      db.$count(apps, eq(apps.projectId, projectId)),
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

  async updateOrThrow(id: string, patch: Partial<{ name: string; platform: string }>) {
    const now = new Date().toISOString();
    const result = await db
      .update(apps)
      .set({ ...patch, updatedAt: now })
      .where(eq(apps.id, id))
      .returning();

    if (result.length === 0) throw notFound("App", id);
    return result[0];
  },

  async delete(id: string) {
    const result = await db.delete(apps).where(eq(apps.id, id)).returning();
    return result.length > 0;
  },

  async deleteByProject(projectId: string) {
    const result = await db.delete(apps).where(eq(apps.projectId, projectId)).returning();
    return result.length;
  },
};