import { db } from "../index.ts";
import { issues } from "../schema/issues.ts";
import { eq, desc, and, ilike, or, sql } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const issueDAO = {
  async createIfNew(data: {
    appId: string;
    fingerprint: string;
    title: string;
    level: string;
    type: string;
    receivedAt: string;
    eventCount: number;
  }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const result = await db
      .insert(issues)
      .values({
        id,
        appId: data.appId,
        fingerprint: data.fingerprint,
        title: data.title,
        status: "unresolved",
        eventCount: data.eventCount,
        firstSeen: data.receivedAt,
        lastSeen: data.receivedAt,
        latestEventId: data.eventCount > 0 ? data.fingerprint : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    return result[0] ?? null;
  },

  async regressIfResolved(data: {
    appId: string;
    fingerprint: string;
    title: string;
    level: string;
    type: string;
    receivedAt: string;
    eventCount: number;
  }) {
    const now = new Date().toISOString();

    const result = await db
      .update(issues)
      .set({
        status: "unresolved",
        eventCount: sql`${issues.eventCount} + ${data.eventCount}`,
        lastSeen: data.receivedAt,
        title: data.title,
        level: data.level,
        type: data.type,
        updatedAt: now,
      })
      .where(and(eq(issues.appId, data.appId), eq(issues.fingerprint, data.fingerprint), eq(issues.status, "resolved")))
      .returning();

    return result[0] ?? null;
  },

  async markSeen(data: {
    appId: string;
    fingerprint: string;
    title: string;
    level: string;
    type: string;
    receivedAt: string;
    eventCount: number;
  }) {
    const now = new Date().toISOString();

    const result = await db
      .update(issues)
      .set({
        eventCount: sql`${issues.eventCount} + ${data.eventCount}`,
        lastSeen: data.receivedAt,
        title: data.title,
        level: data.level,
        type: data.type,
        updatedAt: now,
      })
      .where(and(eq(issues.appId, data.appId), eq(issues.fingerprint, data.fingerprint)))
      .returning();

    return result[0] ?? null;
  },

  async findById(id: string) {
    const result = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const issue = await this.findById(id);
    if (!issue) throw notFound("Issue", id);
    return issue;
  },

  async list(options: {
    appId?: string;
    projectId?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(issues);

    const conditions = [];
    if (options.appId) conditions.push(eq(issues.appId, options.appId));
    if (options.status) conditions.push(eq(issues.status, options.status));
    if (options.search) {
      conditions.push(or(ilike(issues.title, `%${options.search}%`), ilike(issues.fingerprint, `%${options.search}%`)));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(desc(issues.lastSeen)),
      db.$count(issues),
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

  async updateOrThrow(id: string, patch: { status: "unresolved" | "resolved" }) {
    const now = new Date().toISOString();
    const result = await db
      .update(issues)
      .set({ status: patch.status, updatedAt: now })
      .where(eq(issues.id, id))
      .returning();

    if (result.length === 0) throw notFound("Issue", id);
    return result[0];
  },

  async clear() {
    const result = await db.delete(issues).returning();
    return result.length;
  },

  async deleteByApp(appId: string) {
    const result = await db.delete(issues).where(eq(issues.appId, appId)).returning();
    return result.length;
  },
};