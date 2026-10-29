import { db } from "db";
import { issues, type IssueRow, type IssueInsert } from "db/schema/issues";
import { apps } from "db/schema/project";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { notFound } from "backend/errors";
import { cursorAfter, cursorLimit, type CursorPage } from "../cursor";
import type { IssueFilter } from "backend/issues/resolve";
import type { IssueSort } from "backend/issues/query";

const issueFields = {
  id: issues.id,
  appId: issues.appId,
  fingerprint: issues.fingerprint,
  title: issues.title,
  culprit: issues.culprit,
  level: issues.level,
  type: issues.type,
  firstRelease: issues.firstRelease,
  lastRelease: issues.lastRelease,
  tags: issues.tags,
  status: issues.status,
  eventCount: issues.eventCount,
  userCount: issues.userCount,
  firstSeen: issues.firstSeen,
  lastSeen: issues.lastSeen,
  latestEventId: issues.latestEventId,
  updatedAt: issues.updatedAt,
};

// Issue tracking only needs the fields carried into the alert notifications.
const trackedIssueFields = {
  id: issues.id,
  fingerprint: issues.fingerprint,
  title: issues.title,
};

// One occurrence of an issue: the message it came in and the presentation
// fields of the latest occurrence.
export interface IssueOccurrence {
  receivedAt: string;
  latestEventId: string;
  occurrences: number;
  title: string;
  /** The occurrence's tags — the dimensions an alert rule filters on. */
  tags?: Record<string, string>;
  culprit: string | null;
  level: string;
  type: string;
  release: string | null;
}

// The SQL conditions of one filter: the terms of a query alternative.
function issueConditions(filter: IssueFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.statuses) conditions.push(inArray(issues.status, filter.statuses));
  if (filter.excludedStatuses) {
    conditions.push(notInArray(issues.status, filter.excludedStatuses));
  }
  if (filter.appIds) conditions.push(inArray(issues.appId, filter.appIds));
  if (filter.excludedAppIds) {
    conditions.push(notInArray(issues.appId, filter.excludedAppIds));
  }
  if (filter.levels) conditions.push(inArray(issues.level, filter.levels));
  if (filter.excludedLevels) {
    conditions.push(notInArray(issues.level, filter.excludedLevels));
  }
  if (filter.types) conditions.push(inArray(issues.type, filter.types));
  if (filter.excludedTypes) {
    conditions.push(notInArray(issues.type, filter.excludedTypes));
  }
  if (filter.fingerprints) {
    conditions.push(inArray(issues.fingerprint, filter.fingerprints));
  }
  if (filter.excludedFingerprints) {
    conditions.push(
      notInArray(issues.fingerprint, filter.excludedFingerprints),
    );
  }
  for (const text of filter.text ?? []) {
    const pattern = `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(
      sql`(${issues.title} ILIKE ${pattern} OR ${issues.culprit} ILIKE ${pattern} OR ${issues.fingerprint} ILIKE ${pattern})`,
    );
  }
  for (const text of filter.excludedText ?? []) {
    const pattern = `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(
      sql`NOT (${issues.title} ILIKE ${pattern} OR ${issues.culprit} ILIKE ${pattern} OR ${issues.fingerprint} ILIKE ${pattern})`,
    );
  }
  if (filter.firstSeen) {
    if (filter.firstSeen.gte)
      conditions.push(gte(issues.firstSeen, filter.firstSeen.gte));
    if (filter.firstSeen.gt)
      conditions.push(gt(issues.firstSeen, filter.firstSeen.gt));
    if (filter.firstSeen.lte)
      conditions.push(lte(issues.firstSeen, filter.firstSeen.lte));
    if (filter.firstSeen.lt)
      conditions.push(lt(issues.firstSeen, filter.firstSeen.lt));
    if (filter.firstSeen.eq)
      conditions.push(eq(issues.firstSeen, filter.firstSeen.eq));
  }
  if (filter.lastSeen) {
    if (filter.lastSeen.gte)
      conditions.push(gte(issues.lastSeen, filter.lastSeen.gte));
    if (filter.lastSeen.gt)
      conditions.push(gt(issues.lastSeen, filter.lastSeen.gt));
    if (filter.lastSeen.lte)
      conditions.push(lte(issues.lastSeen, filter.lastSeen.lte));
    if (filter.lastSeen.lt)
      conditions.push(lt(issues.lastSeen, filter.lastSeen.lt));
    if (filter.lastSeen.eq)
      conditions.push(eq(issues.lastSeen, filter.lastSeen.eq));
  }
  if (filter.timesSeen) {
    const { operator, value } = filter.timesSeen;
    if (operator === ">") conditions.push(gt(issues.eventCount, value));
    else if (operator === ">=") conditions.push(gte(issues.eventCount, value));
    else if (operator === "<") conditions.push(lt(issues.eventCount, value));
    else if (operator === "<=") conditions.push(lte(issues.eventCount, value));
    else conditions.push(eq(issues.eventCount, value));
  }
  return conditions;
}

export const issueDAO = {
  // Returns the row only when this call created it — the race-safe way to
  // detect a first-ever occurrence (concurrent events lose the unique
  // (app_id, fingerprint) insert and fall through to the other paths).
  createIfNew: (
    data: Omit<IssueInsert, "id"> & { id?: string },
  ): Promise<Pick<IssueRow, "id" | "fingerprint" | "title"> | undefined> =>
    db
      .insert(issues)
      .values({ ...data })
      .onConflictDoNothing()
      .returning(trackedIssueFields)
      .then(([row]) => row),

  // Returns the row only when this call performed the resolved →
  // unresolved transition, so concurrent events produce exactly one
  // regression.
  regressIfResolved: (
    appId: string,
    fingerprint: string,
    occurrence: IssueOccurrence,
  ): Promise<Pick<IssueRow, "id" | "fingerprint" | "title"> | undefined> =>
    db
      .update(issues)
      .set({
        status: "unresolved",
        eventCount: sql`${issues.eventCount} + ${occurrence.occurrences}`,
        lastSeen: occurrence.receivedAt,
        latestEventId: occurrence.latestEventId,
        title: occurrence.title,
        culprit: occurrence.culprit,
        level: occurrence.level,
        type: occurrence.type,
        lastRelease: sql`COALESCE(${occurrence.release}, ${issues.lastRelease})`,
        firstRelease: sql`COALESCE(${issues.firstRelease}, ${occurrence.release})`,
        tags: occurrence.tags ? JSON.stringify(occurrence.tags) : issues.tags,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(issues.appId, appId),
          eq(issues.fingerprint, fingerprint),
          eq(issues.status, "resolved"),
        ),
      )
      .returning(trackedIssueFields)
      .then(([row]) => row),

  // A redelivered message is a no-op: no double `event_count`, no backwards `last_seen`.
  markSeen: (
    appId: string,
    fingerprint: string,
    occurrence: IssueOccurrence,
  ): Promise<void> =>
    db
      .update(issues)
      .set({
        eventCount: sql`${issues.eventCount} + ${occurrence.occurrences}`,
        lastSeen: occurrence.receivedAt,
        latestEventId: occurrence.latestEventId,
        title: occurrence.title,
        culprit: occurrence.culprit,
        level: occurrence.level,
        type: occurrence.type,
        lastRelease: sql`COALESCE(${occurrence.release}, ${issues.lastRelease})`,
        firstRelease: sql`COALESCE(${issues.firstRelease}, ${occurrence.release})`,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(issues.appId, appId),
          eq(issues.fingerprint, fingerprint),
          sql`${issues.latestEventId} IS DISTINCT FROM ${occurrence.latestEventId}`,
          lte(issues.lastSeen, occurrence.receivedAt),
        ),
      ),

  findById: (id: string): Promise<IssueRow | undefined> =>
    db
      .select(issueFields)
      .from(issues)
      .where(eq(issues.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const issue = await issueDAO.findById(id);
    if (!issue) throw notFound("Issue", id);
    return issue;
  },

  listPaged: async (options: {
    /** The alternatives: ORed with each other, ANDed inside. */
    filters?: IssueFilter[];
    sort?: IssueSort;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPage<IssueRow>> => {
    const limit = cursorLimit(options.limit);
    const filters = options.filters ?? [{}];

    const sort = options.sort ?? "new";
    const sortColumn =
      sort === "frequent"
        ? issues.eventCount
        : sort === "users"
          ? issues.userCount
          : sort === "first-seen"
            ? issues.firstSeen
            : issues.lastSeen;
    const tieBreak =
      sort === "frequent" || sort === "users" ? issues.lastSeen : issues.id;
    const order =
      sort === "frequent"
        ? [desc(issues.eventCount), desc(issues.lastSeen), desc(issues.id)]
        : sort === "users"
          ? [desc(issues.userCount), desc(issues.lastSeen), desc(issues.id)]
          : sort === "first-seen"
            ? [desc(issues.firstSeen), desc(issues.id)]
            : [desc(issues.lastSeen), desc(issues.id)];

    const { condition, empty } = await cursorAfter(
      issues,
      issues.id,
      sortColumn,
      options.cursor,
      "desc",
      tieBreak === issues.id ? undefined : tieBreak,
    );
    if (empty) return { data: [] };

    // Every alternative is an AND of its terms; the alternatives are ORed.
    const alternatives = filters
      .map((filter) => {
        const terms = issueConditions(filter);
        return terms.length > 0 ? and(...terms) : undefined;
      })
      .filter((value) => value !== undefined) as SQL[];
    const scope =
      alternatives.length === 1
        ? alternatives[0]!
        : alternatives.length > 0
          ? or(...alternatives)
          : undefined;
    const where =
      scope && condition ? and(scope, condition) : (scope ?? condition);

    const data = await db
      .select(issueFields)
      .from(issues)
      .where(where)
      .orderBy(...order)
      .limit(limit);

    return { data };
  },

  // `sort=users` syncs the distinct-user counts of the issue index into the
  // rows before it orders on them: the sync is a set value, never an
  // increment, so redeliveries cannot inflate it.
  syncUserCounts: async (
    counts: Array<{ appId: string; fingerprint: string; userCount: number }>,
    appIds: string[],
  ): Promise<void> => {
    if (counts.length === 0 || appIds.length === 0) return;
    const fragments = counts.map(
      (row) => sql`(${row.appId}, ${row.fingerprint}, ${row.userCount}::int)`,
    );
    await db.execute(sql`
      UPDATE ${issues} SET user_count = v.user_count
      FROM (VALUES ${sql.join(fragments, sql`, `)}) AS v(app_id, fingerprint, user_count)
      WHERE ${issues.appId} = v.app_id
        AND ${issues.fingerprint} = v.fingerprint
        AND ${issues.userCount} <> v.user_count
        AND ${inArray(issues.appId, appIds)}
    `);
  },

  updateOrThrow: async (id: string, data: Partial<IssueInsert>) => {
    const [updated] = await db
      .update(issues)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(issues.id, id))
      .returning(issueFields);
    if (!updated) {
      throw notFound("Issue", id);
    }
    return updated;
  },

  // Issues whose first-ever occurrence falls inside the window — the
  // `new_issue_count` alert metric, which stays on the control plane.
  countNewSince: async (
    appId: string,
    since: string,
    tags?: Record<string, string>,
  ): Promise<number> => {
    const conditions = [eq(issues.appId, appId), gte(issues.firstSeen, since)];
    // A filtered tag must be on the issue's latest occurrence.
    for (const [key, value] of Object.entries(tags ?? {})) {
      conditions.push(
        sql`${issues.tags}::jsonb @> ${JSON.stringify({ [key]: value })}::jsonb`,
      );
    }
    const total = await db.$count(issues, and(...conditions));
    return Number(total);
  },

  // Issues are derived from stored events, so they die with the app.
  deleteByApp: (appId: string): Promise<void> =>
    db.delete(issues).where(eq(issues.appId, appId)),
};
