import { db } from "db";
import {
  alertDeadLetters,
  type AlertDeadLetterInsert,
} from "db/schema/alert-dead-letters";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import type { AlertDeadLetter } from "backend/protocol/alerting";
import { cursorAfter, cursorLimit, type CursorPage } from "./cursor";
import type { Executor } from "./executor";

type AlertDeadLetterCreateInput = Omit<AlertDeadLetterInsert, "id"> & {
  id?: string;
};

const deadLetterFields = {
  id: alertDeadLetters.id,
  channelId: alertDeadLetters.channelId,
  channelName: alertDeadLetters.channelName,
  channelType: alertDeadLetters.channelType,
  ruleId: alertDeadLetters.ruleId,
  appId: alertDeadLetters.appId,
  notification: sql<unknown>`${alertDeadLetters.notification}::jsonb`,
  error: alertDeadLetters.error,
  attempts: alertDeadLetters.attempts,
  nextAttemptAt: alertDeadLetters.nextAttemptAt,
  createdAt: alertDeadLetters.createdAt,
  updatedAt: alertDeadLetters.updatedAt,
};

export const alertDeadLetterDAO = {
  create: async (
    data: AlertDeadLetterCreateInput,
    executor: Executor = db,
  ): Promise<AlertDeadLetter> => {
    const [created] = await executor
      .insert(alertDeadLetters)
      .values({ ...data, id: data.id ?? crypto.randomUUID() })
      .returning(deadLetterFields);
    if (!created) {
      throw internalError("Failed to record the alert delivery failure");
    }
    return created;
  },

  findById: (id: string): Promise<AlertDeadLetter | undefined> =>
    db
      .select(deadLetterFields)
      .from(alertDeadLetters)
      .where(eq(alertDeadLetters.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string): Promise<AlertDeadLetter> => {
    const letter = await alertDeadLetterDAO.findById(id);
    if (!letter) throw notFound("Alert dead letter", id);
    return letter;
  },

  list: async (options: {
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<AlertDeadLetter>> => {
    const limit = cursorLimit(options.limit);
    const { condition, empty } = await cursorAfter(
      alertDeadLetters,
      alertDeadLetters.id,
      alertDeadLetters.createdAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    const data = await db
      .select(deadLetterFields)
      .from(alertDeadLetters)
      .where(condition)
      .orderBy(desc(alertDeadLetters.createdAt), desc(alertDeadLetters.id))
      .limit(limit);
    return { data };
  },

  // The rows whose retry is due — the worker drains them.
  listDue: (now: string, limit = 20): Promise<AlertDeadLetter[]> =>
    db
      .select(deadLetterFields)
      .from(alertDeadLetters)
      .where(lte(alertDeadLetters.nextAttemptAt, now))
      .orderBy(asc(alertDeadLetters.nextAttemptAt))
      .limit(limit),

  // Records another failed attempt and pushes the next retry back.
  recordAttempt: (
    id: string,
    error: string,
    nextAttemptAt: string,
  ): Promise<void> =>
    db
      .update(alertDeadLetters)
      .set({
        error,
        attempts: sql`${alertDeadLetters.attempts} + 1`,
        nextAttemptAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(alertDeadLetters.id, id)),

  // The retry is due now (a manual retry).
  scheduleNow: (id: string): Promise<void> =>
    db
      .update(alertDeadLetters)
      .set({
        nextAttemptAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(alertDeadLetters.id, id)),

  delete: async (id: string): Promise<boolean> => {
    const deleted = await db
      .delete(alertDeadLetters)
      .where(eq(alertDeadLetters.id, id))
      .returning({ id: alertDeadLetters.id });
    return deleted.length > 0;
  },

  count: (): Promise<number> =>
    db
      .$count(
        alertDeadLetters,
        and(eq(alertDeadLetters.id, alertDeadLetters.id)),
      )
      .then(Number),
};
