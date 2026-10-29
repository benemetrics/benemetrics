import { db } from "db";
import {
  alertChannels,
  channelPublicFields,
  type AlertChannelInsert,
} from "db/schema/alerts";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";
import type { AlertChannel, AlertChannelType } from "backend/protocol/alerting";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";

export const alertChannelDAO = {
  create: async (data: Omit<AlertChannelInsert, "id">) => {
    const [created] = await db
      .insert(alertChannels)
      .values({ ...data })
      .onConflictDoNothing()
      .returning(channelPublicFields);
    if (!created) throw conflict(`Alert channel already exists in this scope: ${data.name}`);
    return created;
  },

  findById: (id: string) => db
      .select(channelPublicFields)
      .from(alertChannels)
      .where(eq(alertChannels.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const channel = await alertChannelDAO.findById(id);
    if (!channel) throw notFound("Alert channel", id);
    return channel;
  },

  list: async (
    options: {
      projectId: string | null;
    },
    page: {
      cursor?: string;
      limit?: number;
    }
  ) => db
      .select(channelPublicFields)
      .from(alertChannels)
      .where(and(whereNotNull(eq, alertChannels.projectId, options.projectId), whereNotNull(lt, alertChannels.id, page?.cursor)))
      .orderBy(desc(alertChannels.id))
      .limit(cursorLimit(page.limit)),

  updateOrThrow: async (id: string, data: Partial<AlertChannelInsert>) => {
      const [updated] = await db
        .update(alertChannels)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(alertChannels.id, id))
        .returning(channelPublicFields);
      if (!updated) throw notFound("Alert channel", id);
      return updated;
  },

  delete: async (id: string) => db
      .delete(alertChannels)
      .where(eq(alertChannels.id, id)),
};
