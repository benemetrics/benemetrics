export function isUniqueViolation(err: unknown): err is Error {
  return err instanceof Error && err.message.includes("duplicate key value violates unique constraint");
}

export function uniqueViolationConstraint(err: unknown): string | null {
  if (!isUniqueViolation(err)) return null;
  const match = err.message.match(/Key \((.+)\)=\(.+\) already exists/);
  if (match && match[1]) return match[1];
  const match2 = err.message.match(/constraint "(.+?)"/);
  return match2 && match2[1] ? match2[1] : null;
}