// Cursor pagination for every list endpoint.
//
// There is no page/offset and no total: a list request carries a page size
// (`limit`) and, to continue, the `cursor` — the id of the last row the
// caller saw. A full page means there may be more; a short page is the end.
// Rows are ordered by the resource's sort key (newest first unless noted)
// tie-broken by id, and the next page is the matching keyset slice, so a
// deep page never scans the rows before it.

import { and, eq, gt, lt, or, type SQL } from "drizzle-orm";
import { db } from "db";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** A page of rows; callers detect "more" with `data.length === limit`. */
export interface CursorPage<T> {
  data: T[];
}

/** The cursor/limit query params every list route declares. */
export interface CursorQuery {
  cursor?: string;
  limit?: number;
}

export function cursorLimit(raw?: number): number {
  return Math.min(Math.max(raw ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

// Keyset condition for the page after `cursor`, ordered by `sort` then `id`.
// `empty` is true when the cursor row no longer exists: the caller returns
// no rows rather than silently restarting from the top.
export async function cursorAfter(
  table: PgTable,
  idColumn: AnyPgColumn,
  sortColumn: AnyPgColumn | SQL,
  cursor: string | undefined,
  direction: "asc" | "desc" = "desc",
  // The column the sort ties break on, when it is not the id.
  tieBreakColumn?: AnyPgColumn,
): Promise<{ condition?: SQL; empty: boolean }> {
  if (!cursor) return { empty: false };

  const tie = tieBreakColumn ?? idColumn;
  const rows = (await db
    .select({ key: sortColumn, tie })
    .from(table)
    .where(eq(idColumn, cursor))
    .limit(1)) as Array<{ key: unknown; tie: unknown }>;

  const anchor = rows[0];
  if (!anchor) return { empty: true };

  const sort = sortColumn as unknown as SQL;
  const compare = direction === "desc" ? lt : gt;
  const sameSort = eq(sort, anchor.key);
  const conditions = tieBreakColumn
    ? or(
        compare(sort, anchor.key),
        and(sameSort, compare(tie, anchor.tie)),
        and(sameSort, eq(tie, anchor.tie), compare(idColumn, cursor)),
      )
    : or(
        compare(sort, anchor.key),
        and(sameSort, compare(idColumn, cursor)),
      );
  return {
    empty: false,
    condition: conditions as SQL,
  };
}
