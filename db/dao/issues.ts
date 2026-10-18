import { db } from "db";
import { issues, type IssueRow, type IssueInsert } from "db/schema/issues";
import { apps } from "db/schema/project";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { notFound } from "backend/errors";

export const issueDAO = {
  // Returns the row only when this call created it — the race-safe way to
  // detect a first-ever occurrence (concurrent events lose the unique
  // (app_id, fingerprint) insert and fall through to the other paths).
  createIfNew: async (
    data: Omit<IssueInsert, "id"> & { id?: string },
  ): Promise<IssueRow | undefined> => {
    const now = new Date().toISOString();
    const [created] = await db
      .insert(issues)
      .values({
        ...data,
        id: data.id ?? crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    return created;
  },

  // Returns the row only when this call performed the resolved →
  // unresolved transition, so concurrent events produce exactly one
  // regression.
  regressIfResolved: async (
    appId: string,
    fingerprint: string,
    receivedAt: string,
    latestEventId: string,
  ): Promise<IssueRow | undefined> => {
    const [updated] = await db
      .update(issues)
      .set({
        status: "unresolved",
        eventCount: sql`${issues.eventCount} + 1`,
        lastSeen: receivedAt,
        latestEventId,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(issues.appId, appId),
          eq(issues.fingerprint, fingerprint),
          eq(issues.status, "resolved"),
        ),
      )
      .returning();
    return updated;
  },

  markSeen: async (
    appId: string,
    fingerprint: string,
    receivedAt: string,
    latestEventId: string,
  ): Promise<void> => {
    await db
      .update(issues)
      .set({
        eventCount: sql`${issues.eventCount} + 1`,
        lastSeen: receivedAt,
        latestEventId,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(issues.appId, appId), eq(issues.fingerprint, fingerprint)));
  },

  findById: async (id: string): Promise<IssueRow | undefined> =>
    (await db.select().from(issues).where(eq(issues.id, id)).limit(1))[0],

  findByIdOrThrow: async (id: string) => {
    const issue = await issueDAO.findById(id);
    if (!issue) throw notFound("Issue", id);
    return issue;
  },

  listPaged: async (options: {
    appId?: string;
    projectId?: string;
    status?: string;
    q?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: IssueRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (options.appId) conditions.push(eq(issues.appId, options.appId));
    if (options.status) conditions.push(eq(issues.status, options.status));
    if (options.projectId) {
      // Issues carry no project; scope through the project's apps.
      conditions.push(
        inArray(
          issues.appId,
          db
            .select({ id: apps.id })
            .from(apps)
            .where(eq(apps.projectId, options.projectId)),
        ),
      );
    }
    if (options.q) {
      const pattern = `%${options.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      conditions.push(
        sql`(${issues.title} ILIKE ${pattern} OR ${issues.fingerprint} ILIKE ${pattern})`,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(issues)
        .where(where)
        .orderBy(desc(issues.lastSeen))
        .limit(limit)
        .offset(offset),
      db.$count(issues, where),
    ]);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    };
  },

  updateOrThrow: async (id: string, data: Partial<IssueInsert>) => {
    const [updated] = await db
      .update(issues)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(issues.id, id))
      .returning();
    if (!updated) {
      throw notFound("Issue", id);
    }
    return updated;
  },

  // Issues whose first-ever occurrence falls inside the window — the
  // `new_issue_count` alert metric, which stays on the control plane.
  countNewSince: async (appId: string, since: string): Promise<number> => {
    const total = await db.$count(
      issues,
      and(eq(issues.appId, appId), gte(issues.firstSeen, since)),
    );
    return Number(total);
  },

  // Issues are derived from stored events, so they die with the app.
  deleteByApp: async (appId: string): Promise<void> => {
    await db.delete(issues).where(eq(issues.appId, appId));
  },

  clear: async (): Promise<void> => {
    await db.delete(issues);
  },
};
