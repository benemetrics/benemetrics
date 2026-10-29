import { db } from "db";
import {
  alertRules,
  type AlertRuleInsert,
  alertRulePublicFields,
} from "db/schema/alerts";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";
import type {
  AlertMetric,
  AlertOperator,
  AlertRule,
  AlertRuleFilters,
  AlertTrigger,
} from "backend/protocol/alerting";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";

const SCOPE_NAME_CONSTRAINT = "alert_rules_name_app_id_idx";
const GLOBAL_NAME_CONSTRAINT = "alert_rules_name_project_id_idx";

type AlertRuleCreateInput = Omit<AlertRuleInsert, "id">;

export const alertRuleDAO = {
  create: async (data: AlertRuleCreateInput) => {
    const [created] = await db
      .insert(alertRules)
      .values({ ...data })
      .onConflictDoNothing()
      .returning(alertRulePublicFields);
    if (!created) {
      throw conflict(`Alert rule already exists in this scope: ${data.name}`);
    }
    return created;
  },

  findById: (id: string): Promise<AlertRule | undefined> =>
    db
      .select(alertRulePublicFields)
      .from(alertRules)
      .where(eq(alertRules.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const rule = await alertRuleDAO.findById(id);
    if (!rule) {
      throw notFound("Alert rule", id);
    }
    return rule;
  },

  listPaged: async (options: {
    appId: string | null;
    projectId?: string | null;
    cursor?: string;
    limit?: number;
  }): Promise<AlertRule[]> => {
    const limit = cursorLimit(options.limit);
    const where = and(
      whereNotNull(eq, alertRules.appId, options.appId ?? undefined),
      whereNotNull(lt, alertRules.id, options.cursor),
    );

    const data = await db
      .select(alertRulePublicFields)
      .from(alertRules)
      .where(where)
      .orderBy(desc(alertRules.id))
      .limit(limit);

    return data;
  },

  updateOrThrow: async (id: string, data: Partial<AlertRuleInsert>) => {
    try {
      const [updated] = await db
        .update(alertRules)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(alertRules.id, id))
        .returning(alertRulePublicFields);
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

  delete: (id: string) => db.delete(alertRules).where(eq(alertRules.id, id)),

  touchTriggered: (
    id: string,
    triggeredAt: string,
  ) =>
    db
      .update(alertRules)
      .set({ lastTriggeredAt: triggeredAt })
      .where(eq(alertRules.id, id)),
};
