import { db } from "db";
import { alertRules, type AlertRuleInsert } from "db/schema/alerts";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";
import type {
  AlertMetric,
  AlertOperator,
  AlertRule,
  AlertRuleFilters,
  AlertTrigger,
} from "backend/protocol/alerting";
import { cursorAfter, cursorLimit, type CursorPage } from "../cursor";
import type { Executor } from "../cursor";


// Scope for alert rules: by appId when set, otherwise unscoped.
// projectId is accepted in the options for API compatibility but the
// schema has no project_id column on alert_rules, so it cannot be used
// to narrow results at the DB level.
type AlertScope = { appId: string | null; projectId?: string | null };

function scopeCondition(scope: AlertScope | null) {
  if (!scope) return undefined;
  const conditions = [];
  if (scope.appId) conditions.push(eq(alertRules.appId, scope.appId));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

const SCOPE_NAME_CONSTRAINT = "alert_rules_name_app_id_idx";
const GLOBAL_NAME_CONSTRAINT = "alert_rules_name_project_id_idx";
const ruleFields = {
  id: alertRules.id,
  name: alertRules.name,
  trigger: sql<AlertTrigger>`${alertRules.trigger}`,
  metric: sql<AlertMetric | null>`${alertRules.metric}`,
  operator: sql<AlertOperator | null>`${alertRules.operator}`,
  threshold: alertRules.threshold,
  thresholdFactor: alertRules.thresholdFactor,
  windowSeconds: alertRules.windowSeconds,
  cooldownSeconds: alertRules.cooldownSeconds,
  measurement: alertRules.measurement,
  folder: alertRules.folder,
  appId: alertRules.appId,
  channelIds: sql<string[]>`'[]'`,
  projectId: sql<string | null>`null`,
  filters: sql<AlertRuleFilters>`${alertRules.filters}::jsonb`,
  message: alertRules.message,
  isEnabled: sql<boolean>`${alertRules.isEnabled} = 1`,
  lastTriggeredAt: alertRules.lastTriggeredAt,
  createdAt: sql<string>`to_char(to_timestamp((substring(${alertRules.id}::text from 1 for 8))::bit(32)::bigint), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
  updatedAt: alertRules.updatedAt,
};

type AlertRuleCreateInput = Omit<AlertRuleInsert, "id">;

export const alertRuleDAO = {
  create: async (data: AlertRuleCreateInput) => {
    const [created] = await db
      .insert(alertRules)
      .values({ ...data })
      .onConflictDoNothing()
      .returning(ruleFields);
    if (!created) {
      throw conflict(`Alert rule already exists in this scope: ${data.name}`);
    }
    return created;
  },

  findById: (id: string): Promise<AlertRule | undefined> =>
    db
      .select(ruleFields)
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
  }): Promise<CursorPage<AlertRule>> => {
    const limit = cursorLimit(options.limit);
    const scope = scopeCondition({
      appId: options.appId,
      projectId: options.projectId,
    });
    const { condition, empty } = await cursorAfter(
      alertRules,
      alertRules.id,
      alertRules.id,
      options.cursor,
    );
    if (empty) return { data: [] };
    const where = condition ? and(scope, condition) : scope;

    const data = await db
      .select(ruleFields)
      .from(alertRules)
      .where(where)
      .orderBy(desc(alertRules.id))
      .limit(limit);

    return { data };
  },

  updateOrThrow: async (id: string, data: Partial<AlertRuleInsert>) => {
    try {
      const [updated] = await db
        .update(alertRules)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(alertRules.id, id))
        .returning(ruleFields);
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

  touchTriggered: (
    id: string,
    triggeredAt: string,
    executor: Executor = db,
  ) =>
    executor
      .update(alertRules)
      .set({ lastTriggeredAt: triggeredAt })
      .where(eq(alertRules.id, id)),
};
