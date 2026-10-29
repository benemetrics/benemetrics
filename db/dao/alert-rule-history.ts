import { db } from "db";
import {
  alertRuleHistory,
  type AlertRuleHistoryInsert,
} from "db/schema/alert-rule-history";
import { and, desc, eq, sql } from "drizzle-orm";
import { internalError } from "backend/errors";
import type { AlertRuleHistory } from "backend/protocol/alerting";
import { cursorAfter, cursorLimit, type CursorPage } from "./cursor";
import type { Executor } from "./executor";

type AlertRuleHistoryCreateInput = Omit<AlertRuleHistoryInsert, "id"> & {
  id?: string;
};

const historyFields = {
  id: alertRuleHistory.id,
  ruleId: alertRuleHistory.ruleId,
  name: alertRuleHistory.name,
  action: sql<AlertRuleHistory["action"]>`${alertRuleHistory.action}`,
  snapshot: sql<Record<string, unknown>>`${alertRuleHistory.snapshot}::jsonb`,
  actor: alertRuleHistory.actor,
  createdAt: alertRuleHistory.createdAt,
};

export const alertRuleHistoryDAO = {
  create: async (
    data: AlertRuleHistoryCreateInput,
    executor: Executor = db,
  ): Promise<AlertRuleHistory> => {
    const [created] = await executor
      .insert(alertRuleHistory)
      .values({ ...data, id: data.id ?? crypto.randomUUID() })
      .returning(historyFields);
    if (!created) {
      throw internalError("Failed to record the alert rule change");
    }
    return created;
  },

  list: async (options: {
    ruleId: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<AlertRuleHistory>> => {
    const limit = cursorLimit(options.limit);
    const { condition, empty } = await cursorAfter(
      alertRuleHistory,
      alertRuleHistory.id,
      alertRuleHistory.createdAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    const scope = eq(alertRuleHistory.ruleId, options.ruleId);
    const data = await db
      .select(historyFields)
      .from(alertRuleHistory)
      .where(condition ? and(scope, condition) : scope)
      .orderBy(desc(alertRuleHistory.createdAt), desc(alertRuleHistory.id))
      .limit(limit);
    return { data };
  },
};
