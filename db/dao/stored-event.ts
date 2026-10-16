import { db } from "db";
import { storedEvents, type StoredEvent, type StoredEventInsert } from "db/schema/stored-event";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "backend/errors";

export const storedEventDAO = {
  create: (data: StoredEventInsert) =>
    db.insert(storedEvents).values(data).onConflictDoNothing().returning(),

  findById: async (id: string): Promise<StoredEvent | undefined> =>
    (
      await db
        .select()
        .from(storedEvents)
        .where(eq(storedEvents.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const event = await storedEventDAO.findById(id);
    if (!event) throw notFound("Event", id);
    return event;
  },

  list: async (options?: {
    page?: number;
    limit?: number;
    projectId?: string;
    appIds?: string[];
  }): Promise<{
    data: StoredEvent[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const offset = (page - 1) * limit;

    // An environment filter resolves to the ids of its apps first;
    // an environment without apps has no events.
    if (options?.appIds && options.appIds.length === 0) {
      return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }

    const conditions = [];
    if (options?.projectId) conditions.push(eq(storedEvents.projectId, options.projectId));
    if (options?.appIds) conditions.push(inArray(storedEvents.appId, options.appIds));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(storedEvents)
        .where(where)
        .orderBy(desc(storedEvents.receivedAt))
        .limit(limit)
        .offset(offset),
      db.$count(storedEvents, where),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    };
  },

  listByProject: async (projectId: string): Promise<StoredEvent[]> =>
    db
      .select()
      .from(storedEvents)
      .where(eq(storedEvents.projectId, projectId))
      .orderBy(asc(storedEvents.receivedAt)),

  listByApp: async (appId: string): Promise<StoredEvent[]> =>
    db
      .select()
      .from(storedEvents)
      .where(eq(storedEvents.appId, appId))
      .orderBy(asc(storedEvents.receivedAt)),

  clear: async () => {
    await db.delete(storedEvents);
  },

  deleteByProject: async (projectId: string) => {
    await db.delete(storedEvents).where(eq(storedEvents.projectId, projectId));
  },

  deleteByApp: async (appId: string) => {
    await db.delete(storedEvents).where(eq(storedEvents.appId, appId));
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(storedEvents)
      .where(eq(storedEvents.id, id))
      .returning({ id: storedEvents.id });
    return deleted.length > 0;
  },
};