import { db } from "db";
import { alertRules, type AlertRuleInsert } from "db/schema/alert-rules";
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
import { cursorAfter, cursorLimit, type CursorPage } from "./cursor";
import type { Executor } from "./executor";

type AlertRuleCreateInput = Omit<AlertRuleInsert, "id"> & {
  id?: string;
};

const SCOPE_NAME_CONSTRAINT = "alert_rules_scope_name_idx";
const GLOBAL_NAME_CONSTRAINT = "alert_rules_global_name_idx";

// appId IS NULL is the global scope.
export interface AlertScope {
  /** The app scope — the narrowest. */
  appId?: string | null;
  /** The project scope. */
  projectId?: string | null;
}

function scopeCondition(scope: AlertScope | null) {
  if (!scope) return isNull(alertRules.appId);
  if (scope.appId) return eq(alertRules.appId, scope.appId);
  if (scope.projectId) {
    return and(
      isNull(alertRules.appId),
      eq(alertRules.projectId, scope.projectId),
    );
  }
  return isNull(alertRules.appId);
}

// `channelIds` is a JSON column and `isEnabled` an integer column stored
// as text/number; both are decoded in the read (protocol shape out).
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
  channelIds: sql<string[]>`${alertRules.channelIds}::jsonb`,
  measurement: alertRules.measurement,
  folder: alertRules.folder,
  appId: alertRules.appId,
  projectId: alertRules.projectId,
  filters: sql<AlertRuleFilters>`${alertRules.filters}::jsonb`,
  message: alertRules.message,
  isEnabled: sql<boolean>`${alertRules.isEnabled} = 1`,
  lastTriggeredAt: alertRules.lastTriggeredAt,
  createdAt: alertRules.createdAt,
  updatedAt: alertRules.updatedAt,
};

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

  // The project-scoped rules — evaluated per project, not per app.
  listProjectScoped: (): Promise<AlertRule[]> =>
    db
      .select(ruleFields)
      .from(alertRules)
      .where(and(isNotNull(alertRules.projectId), isNull(alertRules.appId)))
      .orderBy(desc(alertRules.createdAt)),

  // Every rule, whatever its scope — the export and the import need them
  // all; `list` is the scoped read.
  listAll: (): Promise<AlertRule[]> =>
    db.select(ruleFields).from(alertRules).orderBy(desc(alertRules.createdAt)),

  list: (scope: AlertScope | null): Promise<AlertRule[]> =>
    db
      .select(ruleFields)
      .from(alertRules)
      .where(scopeCondition(scope))
      .orderBy(desc(alertRules.createdAt)),

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
      alertRules.createdAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    const where = condition ? and(scope, condition) : scope;

    const data = await db
      .select(ruleFields)
      .from(alertRules)
      .where(where)
      .orderBy(desc(alertRules.createdAt), desc(alertRules.id))
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

  // Removes the app-scoped overrides only; global (appId = null)
  // rules are shared and stay in place.
  deleteByApp: (appId: string) =>
    db.delete(alertRules).where(eq(alertRules.appId, appId)),

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
