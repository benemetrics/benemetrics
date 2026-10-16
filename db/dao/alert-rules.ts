import { db } from "db";
import {
  alertRules,
  type AlertRuleRow,
  type AlertRuleInsert,
} from "db/schema/alert-rules";
import { desc, eq, isNull } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";

type AlertRuleCreateInput = Omit<AlertRuleInsert, "id"> & {
  id?: string;
};

const SCOPE_NAME_CONSTRAINT = "alert_rules_scope_name_idx";
const GLOBAL_NAME_CONSTRAINT = "alert_rules_global_name_idx";

// appId IS NULL is the global scope.
function scopeCondition(appId: string | null) {
  return appId === null
    ? isNull(alertRules.appId)
    : eq(alertRules.appId, appId);
}

export const alertRuleDAO = {
  create: async (data: AlertRuleCreateInput) => {
    const now = new Date().toISOString();
    const [created] = await db
      .insert(alertRules)
      .values({
        ...data,
        id: data.id ?? crypto.randomUUID(),
        cooldownSeconds: data.cooldownSeconds ?? 3600,
        channelIds: data.channelIds ?? "[]",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw conflict(`Alert rule already exists in this scope: ${data.name}`);
    }
    return created;
  },

  findById: async (id: string): Promise<AlertRuleRow | undefined> =>
    (
      await db
        .select()
        .from(alertRules)
        .where(eq(alertRules.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const rule = await alertRuleDAO.findById(id);
    if (!rule) {
      throw notFound("Alert rule", id);
    }
    return rule;
  },

  list: async (appId: string | null): Promise<AlertRuleRow[]> =>
    db
      .select()
      .from(alertRules)
      .where(scopeCondition(appId))
      .orderBy(desc(alertRules.createdAt)),

  listPaged: async (options: {
    appId: string | null;
    page?: number;
    limit?: number;
  }): Promise<{
    data: AlertRuleRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const where = scopeCondition(options.appId);

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(alertRules)
        .where(where)
        .orderBy(desc(alertRules.createdAt))
        .limit(limit)
        .offset(offset),
      db.$count(alertRules, where),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  updateOrThrow: async (id: string, data: Partial<AlertRuleInsert>) => {
    try {
      const [updated] = await db
        .update(alertRules)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(alertRules.id, id))
        .returning();
      if (!updated) {
        throw notFound("Alert rule", id);
      }
      return updated;
    } catch (err) {
      const constraint = uniqueViolationConstraint(err);
      if (
        data.name !== undefined &&
        (constraint === SCOPE_NAME_CONSTRAINT ||
          constraint === GLOBAL_NAME_CONSTRAINT)
      ) {
        throw conflict(`Alert rule already exists in this scope: ${data.name}`);
      }
      throw err;
    }
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(alertRules)
      .where(eq(alertRules.id, id))
      .returning({ id: alertRules.id });
    return deleted.length > 0;
  },

  // Removes the app-scoped overrides only; global (appId = null)
  // rules are shared and stay in place.
  deleteByApp: async (appId: string) => {
    await db.delete(alertRules).where(eq(alertRules.appId, appId));
  },

  touchTriggered: async (id: string, triggeredAt: string) => {
    await db
      .update(alertRules)
      .set({ lastTriggeredAt: triggeredAt })
      .where(eq(alertRules.id, id));
  },
};
