import { db } from "db";
import {
  alertSilences,
  type AlertSilenceInsert,
} from "db/schema/alert-silences";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import type { AlertSilence, AlertSilenceScope } from "backend/protocol/alerting";
import { cursorAfter, cursorLimit, type CursorPage } from "./cursor";
import type { Executor } from "./executor";

type AlertSilenceCreateInput = Omit<AlertSilenceInsert, "id"> & {
  id?: string;
};

const silenceFields = {
  id: alertSilences.id,
  name: alertSilences.name,
  scopeType: sql<AlertSilenceScope>`${alertSilences.scopeType}`,
  scopeId: alertSilences.scopeId,
  startsAt: alertSilences.startsAt,
  endsAt: alertSilences.endsAt,
  reason: alertSilences.reason,
  createdBy: alertSilences.createdBy,
  createdAt: alertSilences.createdAt,
  updatedAt: alertSilences.updatedAt,
};

export const alertSilenceDAO = {
  create: async (
    data: AlertSilenceCreateInput,
    executor: Executor = db,
  ): Promise<AlertSilence> => {
    const [created] = await executor
      .insert(alertSilences)
      .values({ ...data, id: data.id ?? crypto.randomUUID() })
      .returning(silenceFields);
    if (!created) throw internalError("Failed to create the alert silence");
    return created;
  },

  findById: async (id: string): Promise<AlertSilence | undefined> =>
    (
      await db
        .select(silenceFields)
        .from(alertSilences)
        .where(eq(alertSilences.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string): Promise<AlertSilence> => {
    const silence = await alertSilenceDAO.findById(id);
    if (!silence) throw notFound("Alert silence", id);
    return silence;
  },

  list: async (options: {
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<AlertSilence>> => {
    const limit = cursorLimit(options.limit);
    const { condition, empty } = await cursorAfter(
      alertSilences,
      alertSilences.id,
      alertSilences.startsAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    const data = await db
      .select(silenceFields)
      .from(alertSilences)
      .where(condition)
      .orderBy(desc(alertSilences.startsAt), desc(alertSilences.id))
      .limit(limit);
    return { data };
  },

  // The silences that are active now and cover the scope: the global
  // ones, the project's and the app's.
  findActiveForScope: async (
    scope: { appId?: string | null; projectId?: string | null },
    now: string,
  ): Promise<AlertSilence[]> => {
    const scopeIds = [scope.appId, scope.projectId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    const scopes = [
      eq(alertSilences.scopeType, "global"),
      ...(scopeIds.length > 0
        ? [
            and(
              inArray(alertSilences.scopeType, ["project", "app"]),
              inArray(alertSilences.scopeId, scopeIds),
            ),
          ]
        : []),
    ];
    return await db
      .select(silenceFields)
      .from(alertSilences)
      .where(
        and(
          or(...scopes),
          lte(alertSilences.startsAt, now),
          or(sql`${alertSilences.endsAt} is null`, sql`${alertSilences.endsAt} >= ${now}`),
        ),
      );
  },

  delete: async (id: string): Promise<boolean> => {
    const deleted = await db
      .delete(alertSilences)
      .where(eq(alertSilences.id, id))
      .returning({ id: alertSilences.id });
    return deleted.length > 0;
  },
};
