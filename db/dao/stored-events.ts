import { db } from "../index.ts";
import { storedEvents } from "../schema/stored-events.ts";
import { eq, desc, count } from "drizzle-orm";
import { notFound } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const storedEventDAO = {
  async create(data: {
    id: string;
    projectId: string;
    appId: string | null;
    envelopeHeader: string;
    envelopeItems: string;
    receivedAt: string;
  }) {
    const result = await db
      .insert(storedEvents)
      .values(data)
      .onConflictDoNothing()
      .returning();
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(storedEvents).where(eq(storedEvents.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const event = await this.findById(id);
    if (!event) throw notFound("StoredEvent", id);
    return event;
  },

  async list(options: {
    page?: number;
    limit?: number;
    projectId?: string;
    appId?: string;
  } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(storedEvents);

    if (options.projectId) {
      query = query.where(eq(storedEvents.projectId, options.projectId));
    }
    if (options.appId) {
      query = query.where(eq(storedEvents.appId, options.appId));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset((page - 1) * limit).orderBy(desc(storedEvents.receivedAt)),
      db.$count(storedEvents),
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

  async clear() {
    const result = await db.delete(storedEvents).returning();
    return result.length;
  },
};