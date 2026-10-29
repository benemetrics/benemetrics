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

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

export function cursorLimit(raw?: number): number {
  return Math.min(Math.max(raw ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}
