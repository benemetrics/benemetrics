import { db } from "db";
import {
  alertIncidents,
  type AlertIncidentInsert,
} from "db/schema/alert-incidents";
import { and, desc, eq, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import type {
  AlertIncident,
  AlertIncidentStatus,
  AlertMetric,
  AlertTrigger,
} from "backend/protocol/alerting";
import { cursorAfter, cursorLimit, type CursorPage } from "./cursor";
import type { Executor } from "./executor";

type AlertIncidentCreateInput = Omit<AlertIncidentInsert, "id"> & {
  id?: string;
};

// The enum-ish text columns are cast to the protocol unions in the read.
const incidentFields = {
  id: alertIncidents.id,
  ruleId: alertIncidents.ruleId,
  appId: alertIncidents.appId,
  trigger: sql<AlertTrigger>`${alertIncidents.trigger}`,
  metric: sql<AlertMetric | null>`${alertIncidents.metric}`,
  value: alertIncidents.value,
  threshold: alertIncidents.threshold,
  issueFingerprint: alertIncidents.issueFingerprint,
  status: sql<AlertIncidentStatus>`${alertIncidents.status}`,
  triggeredAt: alertIncidents.triggeredAt,
  resolvedAt: alertIncidents.resolvedAt,
  acknowledgedAt: alertIncidents.acknowledgedAt,
  acknowledgedBy: alertIncidents.acknowledgedBy,
  assignee: alertIncidents.assignee,
};

export const alertIncidentDAO = {
  create: async (
    data: AlertIncidentCreateInput,
    executor: Executor = db,
  ) => {
    const [created] = await executor
      .insert(alertIncidents)
      .values({ ...data, id: data.id ?? crypto.randomUUID() })
      .returning(incidentFields);
    if (!created) {
      throw internalError("Failed to create alert incident");
    }
    return created;
  },

  findById: async (id: string): Promise<AlertIncident | undefined> =>
    (
      await db
        .select(incidentFields)
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
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<AlertIncident>> => {
    const limit = cursorLimit(options.limit);
    const scope = options.appId ? eq(alertIncidents.appId, options.appId) : undefined;
    const { condition, empty } = await cursorAfter(
      alertIncidents,
      alertIncidents.id,
      alertIncidents.triggeredAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    const where = scope && condition ? and(scope, condition) : (scope ?? condition);

    const data = await db
      .select(incidentFields)
      .from(alertIncidents)
      .where(where)
      .orderBy(desc(alertIncidents.triggeredAt), desc(alertIncidents.id))
      .limit(limit);

    return { data };
  },

  listPaged: async (options: {
    appId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<AlertIncident>> => await alertIncidentDAO.list(options),

  updateOrThrow: async (
    id: string,
    data: Partial<typeof alertIncidents.$inferInsert>,
  ): Promise<AlertIncident> => {
    const [updated] = await db
      .update(alertIncidents)
      .set(data)
      .where(eq(alertIncidents.id, id))
      .returning(incidentFields);
    if (!updated) throw notFound("Alert incident", id);
    return updated;
  },

  delete: async (id: string): Promise<boolean> => {
    const deleted = await db
      .delete(alertIncidents)
      .where(eq(alertIncidents.id, id))
      .returning({ id: alertIncidents.id });
    return deleted.length > 0;
  },

  findOpen: async (
    ruleId: string,
    executor: Executor = db,
  ): Promise<AlertIncident | undefined> =>
    (
      await executor
        .select(incidentFields)
        .from(alertIncidents)
        .where(
          and(
            eq(alertIncidents.ruleId, ruleId),
            eq(alertIncidents.status, "firing"),
          ),
        )
        .orderBy(desc(alertIncidents.triggeredAt))
        .limit(1)
    )[0],

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
  findLastForIssue: async (
    ruleId: string,
    fingerprint: string,
  ): Promise<{ triggeredAt: string } | undefined> =>
    (
      await db
        .select({ triggeredAt: alertIncidents.triggeredAt })
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
