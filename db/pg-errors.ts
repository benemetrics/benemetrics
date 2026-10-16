const UNIQUE_VIOLATION = "23505";
const MAX_CAUSE_DEPTH = 10;

export function uniqueViolationConstraint(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;

    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === UNIQUE_VIOLATION || candidate.code === 23505) {
      if (typeof candidate.constraint === "string") return candidate.constraint;

      const match =
        typeof candidate.message === "string"
          ? /duplicate key value violates unique constraint "([^"]+)"/.exec(
              candidate.message,
            )
          : null;
      if (match?.[1]) return match[1];
    }
    current = candidate.cause;
  }
  return undefined;
}
