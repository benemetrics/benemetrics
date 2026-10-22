/**
 * A bounded parallel map — the sweep evaluates many apps, and an unbounded
 * fan-out would open a connection per app.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<unknown>,
): Promise<void> {
  const bounded = Math.max(1, Math.floor(limit));
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(bounded, items.length) },
    async () => {
      while (cursor < items.length) {
        const current = items[cursor]!;
        cursor += 1;
        await run(current);
      }
    },
  );
  await Promise.all(workers);
}
