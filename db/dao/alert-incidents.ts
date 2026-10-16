import { db } from "db";
import {
  alertIncidents,
  type AlertIncidentRow,
  type AlertIncidentInsert,
} from "db/schema/alert-incidents";
import { and, desc, eq } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";

type AlertIncidentCreateInput = Omit<AlertIncidentInsert, "id"> & {
  id?: string;
};

export const alertIncidentDAO = {
  create: async (data: AlertIncidentCreateInput) => {
    const [created] = await db
      .insert(alertIncidents)
      .values({ ...data, id: data.id ?? crypto.randomUUID() })
      .returning();
    if (!created) {
      throw internalError("Failed to create alert incident");
    }
    return created;
  },

  findById: async (id: string): Promise<AlertIncidentRow | undefined> =>
    (
      await db
        .select()
        .from(alertIncidents)
        .where(eq(alertIncidents.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const incident = await alertIncidentDAO.findById(id);
    if (!incident) {
      throw notFound("Alert incident", id);
    }
    return incident;
  },

  list: async (options: {
    appId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: AlertIncidentRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions = options.appId
      ? [eq(alertIncidents.appId, options.appId)]
      : [];
    const where = conditions.length === 1 ? conditions[0] : undefined;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(alertIncidents)
        .where(where)
        .orderBy(desc(alertIncidents.triggeredAt))
        .limit(limit)
        .offset(offset),
      db.$count(alertIncidents, where),
    ]);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Closes every open incident of a rule (the metric recovered).
  resolveOpen: async (ruleId: string) => {
    await db
      .update(alertIncidents)
      .set({ status: "resolved", resolvedAt: new Date().toISOString() })
      .where(
        and(
          eq(alertIncidents.ruleId, ruleId),
          eq(alertIncidents.status, "firing"),
        ),
      );
  },

  // Incidents die with the rule they were fired for.
  deleteByRule: async (ruleId: string) => {
    await db.delete(alertIncidents).where(eq(alertIncidents.ruleId, ruleId));
  },

  // Latest firing of a rule for one issue — drives the per-issue
  // cooldown of issue triggers.
  findLastForIssue: async (ruleId: string, fingerprint: string) =>
    (
      await db
        .select()
        .from(alertIncidents)
        .where(
          and(
            eq(alertIncidents.ruleId, ruleId),
            eq(alertIncidents.issueFingerprint, fingerprint),
          ),
        )
        .orderBy(desc(alertIncidents.triggeredAt))
        .limit(1)
    )[0],

  // Removes incidents fired for the app's own rules; incidents of
  // global rules (appId = null) are shared and stay in place.
  deleteByApp: async (appId: string) => {
    await db.delete(alertIncidents).where(eq(alertIncidents.appId, appId));
  },
};
