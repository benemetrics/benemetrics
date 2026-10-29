// Cursor pagination for every list endpoint.
//
// There is no page/offset and no total: a list request carries a page size
// (`limit`) and, to continue, the `cursor` — the id of the last row the
// caller saw. A full page means there may be more; a short page is the end.
// Rows are ordered by the resource's sort key (newest first unless noted)
// tie-broken by id, and the next page is the matching keyset slice, so a
// deep page never scans the rows before it.
//
// The id is a uuidv7, which is time-ordered, so ordering by id is the same
// as ordering by creation time — there is no separate createdAt column.

import { db } from "db";
import { gt, lt, type SQL } from "drizzle-orm";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

export function cursorLimit(raw?: number): number {
  return Math.min(Math.max(raw ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

export interface CursorPage<T> {
  data: T[];
}

// An executor with the Drizzle methods the DAOs use (db or a transaction).
export type Executor = typeof db;

// Returns the keyset WHERE condition for continuing after `cursor`, plus an
// `empty` flag that is true when the cursor can never match (defensive;
// callers still verify with a short page). For `desc` order the next page
// sits below the cursor; for `asc` order it sits above it.
export async function cursorAfter(
  _table: unknown,
  idColumn: unknown,
  _sortColumn: unknown,
  cursor?: string,
  direction: "asc" | "desc" = "desc",
): Promise<{ condition: SQL | undefined; empty: boolean }> {
  return {
    condition: cursor
      ? (direction === "desc"
          ? lt(idColumn as any, cursor)
          : gt(idColumn as any, cursor))
      : undefined,
    empty: false,
  };
}
