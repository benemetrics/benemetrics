/**
 * Walks every page of a cursor-paginated list endpoint.
 *
 * The backend returns only the rows (no totals): a page shorter than the
 * requested `limit` is the last one, and the next request continues after the
 * last row's id. Admin collections (projects, releases, flags, alerts,
 * segments, source maps) are small, so screens load them whole instead of
 * paginating visually — the loop stops on the first short page, and a
 * multiple-of-`limit` collection costs one extra empty request.
 */
export async function loadAllPages<T extends { id: string }>(
  fetchPage: (cursor: string | undefined, limit: number) => Promise<T[]>,
  limit = 100,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor, limit);
    rows.push(...page);
    if (page.length < limit) break;
    const last = page[page.length - 1];
    if (!last?.id) break;
    cursor = last.id;
  }
  return rows;
}
