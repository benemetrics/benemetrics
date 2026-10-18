import { db } from "../index.ts";
import { alertChannels } from "../schema/alert-channels.ts";
import { eq, desc } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const alertChannelDAO = {
  async create(data: { name: string; type: string; config?: Record<string, unknown>; appId?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(alertChannels)
      .values({
        id,
        name: data.name,
        type: data.type,
        config: JSON.stringify(data.config ?? {}),
        appId: data.appId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict(`Alert channel with name "${data.name}" already exists in this scope`);
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(alertChannels).where(eq(alertChannels.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const channel = await this.findById(id);
    if (!channel) throw notFound("Alert channel", id);
    return channel;
  },

  async list(options: { appId?: string; page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(alertChannels);

    if (options.appId) {
      query = query.where(eq(alertChannels.appId, options.appId));
    } else {
      query = query.where(eq(alertChannels.appId, null));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(alertChannels.createdAt),
      db.$count(alertChannels),
    ]);

    return {
      data,
      pagination: {
        page: options.page ?? 1,
        limit: Math.min(options.limit ?? 20, 100),
        total: totalResult,
        totalPages: Math.ceil(totalResult / Math.min(options.limit ?? 20, 100)),
      },
    };
  },

  async updateOrThrow(id: string, patch: Partial<{ name: string; type: string; config: Record<string, unknown> }>) {
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.type !== undefined) updateData.type = patch.type;
    if (patch.config !== undefined) updateData.config = JSON.stringify(patch.config);

    const result = await db
      .update(alertChannels)
      .set(updateData)
      .where(eq(alertChannels.id, id))
      .returning();

    if (result.length === 0) throw new Error("Alert channel not found");
    return result[0];
  },

  async delete(id: string) {
    const result = await db.delete(alertChannels).where(eq(alertChannels.id, id)).returning();
    return result.length > 0;
  },
};