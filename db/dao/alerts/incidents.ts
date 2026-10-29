import { db } from "db";
import {
  alertIncidents,
  alertIncidentPublicFields,
  type AlertIncidentInsert,
} from "db/schema/alerts";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import type {
  AlertIncident,
  AlertIncidentStatus,
  AlertMetric,
  AlertTrigger,
} from "backend/protocol/alerting";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";

type AlertIncidentCreateInput = Omit<AlertIncidentInsert, "id"> & {
  id?: string;
};

export const alertIncidentDAO = {
  create: async (data: AlertIncidentCreateInput) => {
    const [created] = await db
      .insert(alertIncidents)
      .values({ ...data })
      .returning(alertIncidentPublicFields);
    if (!created) {
      throw internalError("Failed to create alert incident");
    }
    return created;
  },

  findById: (id: string): Promise<AlertIncident | undefined> =>
    db
      .select(alertIncidentPublicFields)
      .from(alertIncidents)
      .where(eq(alertIncidents.id, id))
      .limit(1)
      .then(([row]) => row),

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
  }): Promise<AlertIncident[]> => {
    const limit = cursorLimit(options.limit);
    const where = and(
      whereNotNull(eq, alertIncidents.appId, options.appId ?? undefined),
      whereNotNull(lt, alertIncidents.id, options.cursor),
    );

    const data = await db
      .select(alertIncidentPublicFields)
      .from(alertIncidents)
      .where(where)
      .orderBy(desc(alertIncidents.triggeredAt), desc(alertIncidents.id))
      .limit(limit);

    return data;
  },

  listPaged: (options: {
    appId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<AlertIncident[]> => alertIncidentDAO.list(options),

  updateOrThrow: async (
    id: string,
    data: Partial<typeof alertIncidents.$inferInsert>,
  ): Promise<AlertIncident> => {
    const [updated] = await db
      .update(alertIncidents)
      .set(data)
      .where(eq(alertIncidents.id, id))
      .returning(alertIncidentPublicFields);
    if (!updated) throw notFound("Alert incident", id);
    return updated;
  },

  findOpen: (
    ruleId: string,
  ): Promise<AlertIncident | undefined> =>
    db
      .select(alertIncidentPublicFields)
      .from(alertIncidents)
      .where(
        and(
          eq(alertIncidents.ruleId, ruleId),
          eq(alertIncidents.status, "firing"),
        ),
      )
      .orderBy(desc(alertIncidents.triggeredAt))
      .limit(1)
      .then(([row]) => row),

  // Closes every open incident of a rule (the metric recovered).
  resolveOpen: (ruleId: string) =>
    db
      .update(alertIncidents)
      .set({ status: "resolved", resolvedAt: new Date().toISOString() })
      .where(
        and(
          eq(alertIncidents.ruleId, ruleId),
          eq(alertIncidents.status, "firing"),
        ),
      ),

  // Incidents die with the rule they were fired for.
  deleteByRule: (ruleId: string) =>
    db.delete(alertIncidents).where(eq(alertIncidents.ruleId, ruleId)),

  // Latest firing of a rule for one issue — drives the per-issue
  // cooldown of issue triggers.
  findLastForIssue: (
    ruleId: string,
    fingerprint: string,
  ): Promise<{ triggeredAt: string } | undefined> =>
    db
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
      .then(([row]) => row),

  // The last incident of a correlation group — the deduplication looks at
  // it to decide whether the root cause was already reported.
  findLastByCorrelationKey: (
    correlationKey: string,
  ): Promise<AlertIncident | undefined> =>
    db
      .select(alertIncidentPublicFields)
      .from(alertIncidents)
      .where(eq(alertIncidents.correlationKey, correlationKey))
      .orderBy(desc(alertIncidents.triggeredAt))
      .limit(1)
      .then(([row]) => row),

  // The first incident of a correlation group — the group parent.
  findFirstByCorrelationKey: (
    correlationKey: string,
  ): Promise<AlertIncident | undefined> =>
    db
      .select(alertIncidentPublicFields)
      .from(alertIncidents)
      .where(eq(alertIncidents.correlationKey, correlationKey))
      .orderBy(asc(alertIncidents.triggeredAt))
      .limit(1)
      .then(([row]) => row),
};
