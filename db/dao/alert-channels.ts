import { db } from "db";
import {
  alertChannels,
  type AlertChannelRow,
  type AlertChannelInsert,
} from "db/schema/alert-channels";
import { desc, eq, isNull } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";

type AlertChannelCreateInput = Omit<AlertChannelInsert, "id"> & {
  id?: string;
};

const SCOPE_NAME_CONSTRAINT = "alert_channels_scope_name_idx";
const GLOBAL_NAME_CONSTRAINT = "alert_channels_global_name_idx";

// appId IS NULL is the global scope.
function scopeCondition(appId: string | null) {
  return appId === null
    ? isNull(alertChannels.appId)
    : eq(alertChannels.appId, appId);
}

export const alertChannelDAO = {
  create: async (data: AlertChannelCreateInput) => {
    const now = new Date().toISOString();
    const [created] = await db
      .insert(alertChannels)
      .values({
        ...data,
        id: data.id ?? crypto.randomUUID(),
        config: data.config ?? "{}",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw conflict(`Alert channel already exists in this scope: ${data.name}`);
    }
    return created;
  },

  findById: async (id: string): Promise<AlertChannelRow | undefined> =>
    (
      await db
        .select()
        .from(alertChannels)
        .where(eq(alertChannels.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const channel = await alertChannelDAO.findById(id);
    if (!channel) {
      throw notFound("Alert channel", id);
    }
    return channel;
  },

  list: async (appId: string | null): Promise<AlertChannelRow[]> =>
    db
      .select()
      .from(alertChannels)
      .where(scopeCondition(appId))
      .orderBy(desc(alertChannels.createdAt)),

  listPaged: async (options: {
    appId: string | null;
    page?: number;
    limit?: number;
  }): Promise<{
    data: AlertChannelRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const where = scopeCondition(options.appId);

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(alertChannels)
        .where(where)
        .orderBy(desc(alertChannels.createdAt))
        .limit(limit)
        .offset(offset),
      db.$count(alertChannels, where),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  updateOrThrow: async (id: string, data: Partial<AlertChannelInsert>) => {
    try {
      const [updated] = await db
        .update(alertChannels)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(alertChannels.id, id))
        .returning();
      if (!updated) {
        throw notFound("Alert channel", id);
      }
      return updated;
    } catch (err) {
      const constraint = uniqueViolationConstraint(err);
      if (
        data.name !== undefined &&
        (constraint === SCOPE_NAME_CONSTRAINT ||
          constraint === GLOBAL_NAME_CONSTRAINT)
      ) {
        throw conflict(`Alert channel already exists in this scope: ${data.name}`);
      }
      throw err;
    }
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(alertChannels)
      .where(eq(alertChannels.id, id))
      .returning({ id: alertChannels.id });
    return deleted.length > 0;
  },

  // Removes the app-scoped overrides only; global (appId = null)
  // channels are shared and stay in place.
  deleteByApp: async (appId: string) => {
    await db.delete(alertChannels).where(eq(alertChannels.appId, appId));
  },
};
