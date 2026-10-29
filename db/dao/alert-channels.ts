import { db } from "db";
import {
  alertChannels,
  type AlertChannelInsert,
} from "db/schema/alert-channels";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";
import type { AlertChannel, AlertChannelType } from "backend/protocol/alerting";
import { cursorAfter, cursorLimit, type CursorPage } from "./cursor";

type AlertChannelCreateInput = Omit<AlertChannelInsert, "id"> & {
  id?: string;
};

const SCOPE_NAME_CONSTRAINT = "alert_channels_scope_name_idx";
const GLOBAL_NAME_CONSTRAINT = "alert_channels_global_name_idx";

// appId IS NULL is the global scope.
export interface AlertScope {
  /** The app scope — the narrowest. */
  appId?: string | null;
  /** The project scope. */
  projectId?: string | null;
}

function scopeCondition(scope: AlertScope | null) {
  if (!scope) return isNull(alertChannels.appId);
  if (scope.appId) return eq(alertChannels.appId, scope.appId);
  if (scope.projectId) {
    return and(
      isNull(alertChannels.appId),
      eq(alertChannels.projectId, scope.projectId),
    );
  }
  return isNull(alertChannels.appId);
}

// `config` is a JSON column stored as text; decode it in the read so
// callers get the protocol shape directly.
const channelFields = {
  id: alertChannels.id,
  name: alertChannels.name,
  type: sql<AlertChannelType>`${alertChannels.type}`,
  config: sql<Record<string, unknown>>`${alertChannels.config}::jsonb`,
  appId: alertChannels.appId,
  projectId: alertChannels.projectId,
  createdAt: alertChannels.createdAt,
  updatedAt: alertChannels.updatedAt,
};

export const alertChannelDAO = {
  create: async (data: AlertChannelCreateInput) => {
    const [created] = await db
      .insert(alertChannels)
      .values({ ...data })
      .onConflictDoNothing()
      .returning(channelFields);
    if (!created) {
      throw conflict(
        `Alert channel already exists in this scope: ${data.name}`,
      );
    }
    return created;
  },

  findById: async (id: string): Promise<AlertChannel | undefined> =>
    (
      await db
        .select(channelFields)
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

  // Every channel, whatever its scope — the import resolves the channel
  // names; `list` is the scoped read.
  listAll: async (): Promise<AlertChannel[]> =>
    db
      .select(channelFields)
      .from(alertChannels)
      .orderBy(desc(alertChannels.createdAt)),

  list: async (scope: AlertScope | null): Promise<AlertChannel[]> =>
    db
      .select(channelFields)
      .from(alertChannels)
      .where(scopeCondition(scope))
      .orderBy(desc(alertChannels.createdAt)),

  listPaged: async (options: {
    appId: string | null;
    projectId?: string | null;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<AlertChannel>> => {
    const limit = cursorLimit(options.limit);
    const scope = scopeCondition({
      appId: options.appId,
      projectId: options.projectId,
    });
    const { condition, empty } = await cursorAfter(
      alertChannels,
      alertChannels.id,
      alertChannels.createdAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    const where = condition ? and(scope, condition) : scope;

    const data = await db
      .select(channelFields)
      .from(alertChannels)
      .where(where)
      .orderBy(desc(alertChannels.createdAt), desc(alertChannels.id))
      .limit(limit);

    return { data };
  },

  updateOrThrow: async (id: string, data: Partial<AlertChannelInsert>) => {
    try {
      const [updated] = await db
        .update(alertChannels)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(alertChannels.id, id))
        .returning(channelFields);
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
        throw conflict(
          `Alert channel already exists in this scope: ${data.name}`,
        );
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
